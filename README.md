# Project Overview
This is a web scraper that extracts video metadata, stores it in a database, and sends new videos to MomentsLab for analysis.

# How It Works
- Scrape the latest 5 videos.
- Check if they are already stored in the database.
- Extract metadata (title, date, duration, description, personalities, download link).
- Save new videos to the database.
- Send unanalyzed videos to MomentsLab for processing.

# Tech Stack
- **Programming Language:** JavaScript (Node.js)
- **Web Scraping Framework:** Playwright
- **Database:** PostgreSQL
- **API Requests:** Axios
- **Containerization:** Docker
- **Environment Management:** dotenv
- **Logging:** Custom Logger

# Clone the Repository
```sh
git clone git@github.com:crisperience/video-scrapers.git
cd video-scrapers
