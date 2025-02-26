# Video Scrapers

## **Project Overview**
This is a web scraper that extracts video metadata, stores it in a database, and sends new videos to MomentsLab for analysis.

### **How It Works:**
- Scrapes the latest 5 videos from the EU Commission website.
- Checks if they are already stored in the database.
- Extracts metadata (title, date, duration, description, personalities, download link).
- Saves new videos to the database.
- Sends unanalyzed videos to MomentsLab for processing.
