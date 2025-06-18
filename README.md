# IP Monitor

This simple web application allows you to upload a CSV or XLSX file with server
information and monitor reachability of the server IP addresses.

## Features
- Upload CSV/XLSX files containing server name, primary IP and IPMI IP.
- Start/stop periodic ping tests on the uploaded IP addresses.
- Export ping results back to a CSV file.

## Requirements
- Python 3.10+
- The packages listed in `requirements.txt` (including `ping3`).

## Running
1. Install Python dependencies
   ```bash
   pip install -r requirements.txt
   ```
2. Start the application
   ```bash
   python app.py
   ```
3. Visit `http://localhost:5000` in your browser.

Uploaded files are stored in the `uploads` directory. Exported files will be
created in the same directory with the suffix `_export.csv`.

## Node.js version

An Express implementation is available in `server.js` and requires Node.js 20 or newer.

1. Install dependencies (Express, EJS, etc.)
   ```bash
   npm install
   ```
2. Start the server
   ```bash
   npm start
   ```

The routes mirror the Flask version and files are saved in the same `uploads` directory.
