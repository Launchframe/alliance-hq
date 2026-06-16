ALTER TABLE video_frames ADD COLUMN IF NOT EXISTS upload_ms integer;
ALTER TABLE video_frames ADD COLUMN IF NOT EXISTS extract_ms integer;
ALTER TABLE video_frames ADD COLUMN IF NOT EXISTS ocr_entry_count integer;
ALTER TABLE video_frames ADD COLUMN IF NOT EXISTS ocr_error text;
ALTER TABLE video_frames ADD COLUMN IF NOT EXISTS ocr_raw_json jsonb;

ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS timings_json jsonb;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS total_file_size_bytes bigint;
