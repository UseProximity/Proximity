-- Adds a read-only admin role alongside super.
-- admin users can view the admin dashboard and "view as" other users
-- but cannot perform any mutations. Enforcement lives in the app layer
-- (see src/app/api/admin/* and src/app/dashboard/admin/*).
INSERT INTO roles (name) VALUES ('admin') ON CONFLICT (name) DO NOTHING;
