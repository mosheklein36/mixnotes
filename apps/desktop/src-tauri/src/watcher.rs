//! Watches the export folder and emits `file-ready` once an audio file has
//! finished being written (size and mtime unchanged for STABLE_FOR).

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav"];
const POLL_INTERVAL: Duration = Duration::from_millis(500);
const STABLE_FOR: Duration = Duration::from_secs(2);
const GIVE_UP_AFTER: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ReadyFile {
    pub path: String,
    pub filename: String,
    pub hash: String,
    pub size: u64,
}

pub fn is_audio_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if name.starts_with('.') || name.starts_with('~') {
        return false;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn snapshot(path: &Path) -> Option<(u64, SystemTime)> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    Some((meta.len(), meta.modified().ok()?))
}

/// Blocks until the file stops changing, then hashes it.
/// Returns None if the file disappears or never settles.
pub fn wait_until_stable(path: &Path, poll: Duration, stable_for: Duration, give_up: Duration) -> Option<ReadyFile> {
    let started = Instant::now();
    let mut last = snapshot(path)?;
    let mut stable_since = Instant::now();
    loop {
        thread::sleep(poll);
        if started.elapsed() > give_up {
            return None;
        }
        let current = snapshot(path)?;
        if current != last {
            last = current;
            stable_since = Instant::now();
            continue;
        }
        if last.0 == 0 || stable_since.elapsed() < stable_for {
            continue;
        }
        // Still locked by the exporter on some platforms; keep waiting.
        let Ok(hash) = hash_file(path) else {
            stable_since = Instant::now();
            continue;
        };
        if snapshot(path)? != last {
            continue;
        }
        return Some(ReadyFile {
            path: path.to_string_lossy().into_owned(),
            filename: path.file_name()?.to_string_lossy().into_owned(),
            hash,
            size: last.0,
        });
    }
}

fn modified_ms(path: &Path) -> Option<u128> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_millis())
}

/// Audio files in `dir` modified after `since_ms` (exports made while the app was closed).
pub fn files_modified_since(dir: &Path, since_ms: u128) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![];
    };
    entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| is_audio_file(p) && modified_ms(p).map(|m| m > since_ms).unwrap_or(false))
        .collect()
}

type OnReady = Arc<dyn Fn(ReadyFile) + Send + Sync>;

pub struct FolderWatcher {
    _watcher: RecommendedWatcher,
}

impl FolderWatcher {
    pub fn start(
        dir: &Path,
        since_ms: u128,
        on_ready: OnReady,
        on_error: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<Self, String> {
        if !dir.is_dir() {
            return Err(format!("Folder not found: {}", dir.display()));
        }
        let pending: Arc<Mutex<HashSet<PathBuf>>> = Arc::default();

        let schedule = {
            let pending = pending.clone();
            let on_ready = on_ready.clone();
            move |path: PathBuf| {
                if !is_audio_file(&path) || !pending.lock().unwrap().insert(path.clone()) {
                    return;
                }
                let pending = pending.clone();
                let on_ready = on_ready.clone();
                thread::spawn(move || {
                    let result = wait_until_stable(&path, POLL_INTERVAL, STABLE_FOR, GIVE_UP_AFTER);
                    pending.lock().unwrap().remove(&path);
                    if let Some(file) = result {
                        on_ready(file);
                    }
                });
            }
        };

        let handler_schedule = schedule.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| match res {
            Ok(event) => {
                if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                    for path in event.paths {
                        handler_schedule(path);
                    }
                }
            }
            Err(err) => on_error(err.to_string()),
        })
        .map_err(|e| e.to_string())?;
        watcher.watch(dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;

        for path in files_modified_since(dir, since_ms) {
            schedule(path);
        }

        Ok(Self { _watcher: watcher })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::mpsc;

    #[test]
    fn filters_audio_files() {
        assert!(is_audio_file(Path::new("/x/Summer Anthem.mp3")));
        assert!(is_audio_file(Path::new("/x/a.WAV")));
        assert!(!is_audio_file(Path::new("/x/a.flp")));
        assert!(!is_audio_file(Path::new("/x/a.mp3.part")));
        assert!(!is_audio_file(Path::new("/x/~a.mp3")));
        assert!(!is_audio_file(Path::new("/x/.a.mp3")));
    }

    #[test]
    fn waits_for_writes_to_finish() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("track.mp3");
        let writer_path = path.clone();
        let writer = thread::spawn(move || {
            let mut f = File::create(&writer_path).unwrap();
            for _ in 0..5 {
                f.write_all(&[1u8; 1024]).unwrap();
                f.flush().unwrap();
                thread::sleep(Duration::from_millis(150));
            }
        });
        thread::sleep(Duration::from_millis(50));
        let ready = wait_until_stable(&path, Duration::from_millis(50), Duration::from_millis(400), Duration::from_secs(10)).unwrap();
        writer.join().unwrap();
        assert_eq!(ready.size, 5 * 1024);
        assert_eq!(ready.hash, hash_file(&path).unwrap());
    }

    #[test]
    fn missing_file_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(wait_until_stable(&dir.path().join("nope.mp3"), Duration::from_millis(10), Duration::from_millis(10), Duration::from_secs(1)).is_none());
    }

    #[test]
    fn detects_new_and_overwritten_exports() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("old.mp3"), b"existing").unwrap();
        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
        thread::sleep(Duration::from_millis(20));

        let (tx, rx) = mpsc::channel::<ReadyFile>();
        let tx = Mutex::new(tx);
        let _w = FolderWatcher::start(
            dir.path(),
            now_ms,
            Arc::new(move |f| tx.lock().unwrap().send(f).unwrap()),
            Arc::new(|e| panic!("{e}")),
        )
        .unwrap();

        fs::write(dir.path().join("Summer Anthem.mp3"), b"v1 audio").unwrap();
        let first = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(first.filename, "Summer Anthem.mp3");

        fs::write(dir.path().join("Summer Anthem.mp3"), b"v2 audio, different").unwrap();
        let second = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(second.filename, "Summer Anthem.mp3");
        assert_ne!(first.hash, second.hash);

        fs::write(dir.path().join("notes.txt"), b"ignored").unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(4)).is_err(), "pre-existing and non-audio files are ignored");
    }

    #[test]
    fn picks_up_exports_made_while_closed() {
        let dir = tempfile::tempdir().unwrap();
        let before = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
        thread::sleep(Duration::from_millis(20));
        fs::write(dir.path().join("offline.mp3"), b"x").unwrap();
        let found = files_modified_since(dir.path(), before);
        assert_eq!(found.len(), 1);
        assert!(files_modified_since(dir.path(), before + 60_000).is_empty());
    }
}
