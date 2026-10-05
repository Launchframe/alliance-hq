-- Custom SQL migration file, put your code below! --
INSERT INTO permissions (id, description) VALUES ('hq:events:write', 'Manage HQ native events')
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'hq:events:write' FROM roles r WHERE r.name IN ('officer')
ON CONFLICT DO NOTHING;
