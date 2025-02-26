// common/db.js
const { Pool } = require('pg');
require('dotenv').config();
const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      video_id TEXT UNIQUE,
      published_date TEXT,
      title TEXT,
      description TEXT,
      personalities TEXT,
      duration TEXT,
      download_url TEXT,
      momentslab_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE INDEX IF NOT EXISTS video_id_index ON videos(video_id);
  `;
  await pool.query(createTableQuery);
  logger.info("PostgreSQL database initialized.");
  return pool;
}

async function videoExists(video_id) {
  const res = await pool.query("SELECT COUNT(*) FROM videos WHERE video_id = $1", [video_id]);
  return res.rows[0].count > 0;
}

async function saveMetadata(video_id, published_date, title, description, personalities, duration, download_url) {
  const insertQuery = `
    INSERT INTO videos (video_id, published_date, title, description, personalities, duration, download_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (video_id) DO NOTHING;
  `;
  await pool.query(insertQuery, [video_id, published_date, title, description, personalities, duration, download_url]);
  logger.info(`Saved metadata for video_id: ${video_id}`);
}

async function getUnanalyzedVideos(limit = 5) {
  const res = await pool.query("SELECT video_id, title, download_url FROM videos WHERE momentslab_id IS NULL ORDER BY id DESC LIMIT $1", [limit]);
  return res.rows;
}

async function setMomentslabID(video_id, analysis_id) {
  await pool.query("UPDATE videos SET momentslab_id = $1 WHERE video_id = $2", [analysis_id, video_id]);
  logger.info(`Set MomentsLab analysis ID for ${video_id} to ${analysis_id}`);
}

module.exports = { initDB, videoExists, saveMetadata, getUnanalyzedVideos, setMomentslabID, pool };