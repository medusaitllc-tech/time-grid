-- Connect to PostgreSQL as superuser (postgres)
-- Run: psql -U postgres

-- Create the database


-- Create a new user with password and CREATEDB privilege
CREATE USER timegrid_user WITH PASSWORD '2h8NN7mNjnnnAmcosaCo' CREATEDB;

CREATE DATABASE timegrid_dev WITH OWNER timegrid_user;
-- Grant all privileges on the database to the user
GRANT ALL PRIVILEGES ON DATABASE timegrid_dev TO timegrid_user;

-- NOTE: After running the above commands, manually switch to the timegrid_dev database in your GUI tool
-- Then run the commands below in the timegrid_dev database context

-- Grant schema privileges (required for PostgreSQL 15+)
GRANT ALL ON SCHEMA public TO timegrid_user;

-- Grant privileges on all existing tables
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO timegrid_user;

-- Grant privileges on all sequences (for auto-increment)
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO timegrid_user;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO timegrid_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO timegrid_user;