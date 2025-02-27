const { Pool } = require('pg');
require('dotenv').config();
const logger = require('./logger');

// Ensure the DATABASE_URL is set in the environment
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set! Check your .env file or environment variables.");
}

logger.info(`Connecting to database: "${connectionString}"`);

// Manually parse the DATABASE_URL
let dbConfig;
try {
  const url = new URL(connectionString);
  dbConfig = {
    user: url.username,
    password: url.password,
    host: url.hostname,
    port: url.port || 5432, // fallback if port not specified
    database: url.pathname.replace('/', ''), // remove leading '/'
    ssl: { rejectUnauthorized: false },
  };
} catch (error) {
  logger.error(`Invalid DATABASE_URL: ${connectionString}`);
  process.exit(1);
}

// Create a single pool instance using dbConfig
const pool = new Pool(dbConfig);

async function initDB() {
  logger.info(`Connected to PostgreSQL at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS public.videos (
      id SERIAL PRIMARY KEY,
      content_provider TEXT,
      video_id TEXT UNIQUE NOT NULL,
      published_date TEXT,
      title TEXT,
      description TEXT,
      personalities TEXT,
      duration TEXT,
      download_url TEXT,
      momentslab_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE INDEX IF NOT EXISTS video_id_index ON public.videos(video_id);
  `;

  try {
    await pool.query(createTableQuery);
    logger.info("PostgreSQL database initialized.");
  } catch (error) {
    logger.error(`Error initializing the database: ${error.message}`);
    process.exit(1);
  }
}

// Check if video already exists in the database
async function videoExists(video_id) {
  const res = await pool.query("SELECT COUNT(*) FROM public.videos WHERE video_id = $1", [video_id]);
  return parseInt(res.rows[0].count, 10) > 0;
}

// Save video metadata, including content_provider
async function saveMetadata(content_provider, video_id, published_date, title, description, personalities, duration, download_url) {
  const insertQuery = `
    INSERT INTO public.videos (content_provider, video_id, published_date, title, description, personalities, duration, download_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (video_id) DO NOTHING;
  `;
  try {
    await pool.query(insertQuery, [content_provider, video_id, published_date, title, description, personalities, duration, download_url]);
    logger.info(`Saved metadata for video_id: ${video_id}, provider: ${content_provider}`);
  } catch (error) {
    logger.error(`Error saving metadata (video_id: ${video_id}): ${error.message}`);
  }
}

// Get unanalyzed videos (videos without a MomentsLab ID)
async function getUnanalyzedVideos(limit = 5) {
  const res = await pool.query(
    "SELECT video_id, title, download_url FROM public.videos WHERE momentslab_id IS NULL ORDER BY id DESC LIMIT $1",
    [limit]
  );
  return res.rows;
}

// Set MomentsLab analysis ID for a video
async function setMomentslabID(video_id, analysis_id) {
  try {
    await pool.query("UPDATE public.videos SET momentslab_id = $1 WHERE video_id = $2", [analysis_id, video_id]);
    logger.info(`Set MomentsLab analysis ID for video ${video_id} to ${analysis_id}`);
  } catch (error) {
    logger.error(`Error setting MomentsLab analysis ID for video ${video_id}: ${error.message}`);
  }
}

module.exports = { initDB, videoExists, saveMetadata, getUnanalyzedVideos, setMomentslabID, pool };