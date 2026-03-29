# KaziHunt — Smart Job Search Tool

KaziHunt helps you find jobs in one place. Search local jobs by country and city, or browse remote jobs worldwide — all from a single clean interface.

---

## Features

- **Local Jobs** — powered by Adzuna (15 countries)
- **Remote Jobs** — powered by Remotive (worldwide)
- Sort by relevance, date, or salary
- Filter by job type, salary range, and category
- Search within results in real time
- Save favourite jobs (stored in your browser)
- Click any job card to expand the description and apply
- **Salary Insights** — bar chart (salary distribution) and line chart (salary trend over time) for any local job search

---

## APIs Used

### Adzuna API
Used for all local job searches across 15 countries. Also powers the salary histogram and salary history charts.

- Official documentation: https://developer.adzuna.com/
- Endpoints used:
  - `GET /v1/api/jobs/{country}/search/{page}` — job search results
  - `GET /v1/api/jobs/{country}/histogram` — salary distribution by range
  - `GET /v1/api/jobs/{country}/history` — average salary per month over time
  - `GET /v1/api/jobs/{country}/categories` — job categories per country
- Authentication: App ID + App Key (passed as query parameters)
- Free tier: available at https://developer.adzuna.com/signup

### Remotive API
Used for remote job listings worldwide. No authentication required.

- Official documentation: https://remotive.com/api/remote-jobs
- Endpoints used:
  - `GET /api/remote-jobs` — full list of current remote jobs (filtered client-side by keyword and category)
- Results are cached on the server for 30 minutes to avoid repeated calls

---

## Run Locally

### 1. Clone the repo

```bash
git clone https://github.com/ehabimfura/kazihunt.git
cd kazihunt
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
nano .env
```

Fill in your Adzuna credentials:

```
ADZUNA_APP_ID=your_app_id_here
ADZUNA_APP_KEY=your_app_key_here
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=http://localhost:3000
```

Get free API keys at: https://developer.adzuna.com/

### 4. Start the server

```bash
npm start
```

Open your browser at: **http://localhost:3000**

For development with auto-reload:

```bash
npm run dev
```

---

## Deploy to Servers (Web01 and Web02)

Run these steps on **both** Web01 and Web02.

### 1. Install dependencies on the server

```bash
sudo apt update
sudo apt install -y nodejs npm nginx
sudo npm install -g pm2
```

### 2. Clone and set up the project

```bash
cd /var/www
sudo git clone https://github.com/ehabimfura/kazihunt.git
cd kazihunt
npm install
```

### 3. Create the .env file

```bash
nano .env
```

Paste your API keys (same as local setup above).

### 4. Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

This keeps the app running after server restarts.

### 5. Configure Nginx

```bash
sudo cp nginx/web-server.conf /etc/nginx/sites-available/kazihunt
sudo ln -s /etc/nginx/sites-available/kazihunt /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Test

Open the server's IP address in your browser. You should see KaziHunt running.

---

## Configure the Load Balancer (Lb01)

### 1. Install Nginx on Lb01

```bash
sudo apt update
sudo apt install -y nginx
```

### 2. Edit the load balancer config

```bash
sudo nano /etc/nginx/sites-available/kazihunt-lb
```

Paste the contents of `nginx/load-balancer.conf`. The `upstream` block already has the real IPs for Web01 and Web02 filled in. Update them here if your IPs ever change.

### 3. Enable and reload

```bash
sudo ln -s /etc/nginx/sites-available/kazihunt-lb /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Test the load balancer

Open the Lb01 IP address in your browser. Refresh several times — traffic will be distributed between Web01 and Web02 using round-robin.

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ADZUNA_APP_ID` | Your Adzuna App ID | `xxxxxxxx` |
| `ADZUNA_APP_KEY` | Your Adzuna App Key | `xxxxxxxxxxxxxxxx` |
| `PORT` | Port the Node.js server listens on | `3000` |
| `NODE_ENV` | Environment mode | `production` |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed origins for CORS | `http://lb01-ip,http://localhost:3000` |

> **Never commit your `.env` file.** It is already listed in `.gitignore`.

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/jobs/local` | Search Adzuna local jobs |
| GET | `/api/jobs/remote` | Search Remotive remote jobs |
| GET | `/api/categories/remote` | Get Remotive job categories |
| GET | `/api/categories/local/:country` | Get Adzuna categories for a country |
| GET | `/api/salary/histogram` | Salary distribution chart data for a keyword + location |
| GET | `/api/salary/history` | Average salary trend over recent months |
| GET | `/api/health` | Health check — returns `{ status: "ok" }` |

---

## Security

- API keys are stored in `.env` — never sent to the browser
- All API calls go through the Express backend (proxy pattern)
- Rate limiting: 30 requests per minute per IP
- CORS restricted to allowed origins only
- Helmet.js sets secure HTTP headers (CSP, X-Frame-Options, etc.)
- All user inputs are sanitized before use (HTML stripped, Unicode-safe regex)

---

## Challenges

**1. Hiding API keys from the browser**
The Adzuna API requires an App ID and App Key in every request. Sending those directly from the browser would expose them to anyone reading the network tab. The solution was to build an Express backend that acts as a proxy — the browser calls `/api/jobs/local`, the server adds the secret keys, calls Adzuna, and returns the result. The keys never leave the server.

**2. Salary parsing across different formats**
Remotive job listings display salary as free-text strings like `"$120k"`, `"£60,000 – £80,000"`, or `"€50K per year"`. A simple `parseInt` would return `120` instead of `120000`. This required writing a custom `parseSalary()` function that strips currency symbols, removes commas, detects `k` and `m` suffixes, and returns the correct numeric value — making salary filtering and sorting work correctly across both APIs.

**3. Input sanitization breaking international city names**
The original sanitization regex `[^a-zA-Z0-9 \-,.]` blocked valid city names like `São Paulo` and `Köln` because it didn't allow accented characters. The fix was switching to a Unicode-aware regex using `\p{L}` (any letter in any language) and `\p{N}` (any number), which correctly accepts international characters while still blocking HTML and special characters.

**4. Chart.js requiring canvas cleanup between searches**
Chart.js attaches itself to a `<canvas>` element and holds a reference to it. Drawing a new chart on the same canvas without destroying the old one caused visual glitches and console warnings. The solution was to keep references to the chart instances (`histogramChartInstance`, `historyChartInstance`) and call `.destroy()` on them before drawing new charts on each search.

**5. CSS media query accidentally applying mobile styles globally**
When adding the salary insights styles, a new `@media (max-width: 768px)` block was opened but the existing responsive styles were left outside the closing brace. This caused all mobile-only styles (stacked search form, smaller fonts, column layouts) to apply on desktop too, completely breaking the layout. The fix was merging everything into one properly closed `@media` block.

---

## Credits

| Resource | Link |
|----------|------|
| **Adzuna API** — local job listings and salary data | https://developer.adzuna.com/ |
| **Remotive API** — remote job listings | https://remotive.com/api/remote-jobs |
| **Express.js** — backend framework | https://expressjs.com/ |
| **Helmet.js** — HTTP security headers | https://helmetjs.github.io/ |
| **express-rate-limit** — rate limiting | https://github.com/express-rate-limit/express-rate-limit |
| **Axios** — HTTP client | https://axios-http.com/ |
| **Chart.js** — salary insight charts | https://www.chartjs.org/ |
| **Open Sans** — body font | https://fonts.google.com/specimen/Open+Sans |
| **Playfair Display** — heading font | https://fonts.google.com/specimen/Playfair+Display |
| **Unsplash** — hero background images | https://unsplash.com/ |
