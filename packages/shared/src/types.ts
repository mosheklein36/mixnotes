export interface Project {
  id: string;
  user_id: string;
  name: string;
  latest_upload_at: string | null;
  created_at: string;
}

export interface Version {
  id: string;
  user_id: string;
  project_id: string;
  storage_path: string;
  filename: string;
  file_hash: string;
  duration_seconds: number | null;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  version_id: string;
  timestamp_seconds: number;
  text: string;
  done: boolean;
  created_at: string;
  updated_at: string;
}
