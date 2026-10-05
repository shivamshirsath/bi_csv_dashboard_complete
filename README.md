# CSV Intelligence Dashboard

A fully client-side HTML/CSS/JavaScript dashboard.

## Features

- Drag-and-drop CSV upload
- Automatic column detection
- KPI cards
- Routing mix doughnut chart
- Latency by target
- Latency by task type
- Alert/smoke routing comparison
- Time-series latency trend
- CPU load vs latency scatter plot
- Auto-generated strategic insights
- Target and task filters
- Data preview table
- Export complete dashboard as PNG
- Responsive mobile/desktop layout

## Recommended CSV columns

The app automatically detects these columns and common aliases:

- `Timestamp`
- `Latency_ms`
- `Edge_CPU_Load_%`
- `Task_Type`
- `Target`
- `Smoke_Detected`

## How to run

Because the page uses Chart.js, Papa Parse and html2canvas from jsDelivr, Internet access is required when loading the page.

### Easiest method
Open `index.html` directly in Chrome/Edge/Firefox.

### Better local-development method
Run a simple local server in the project directory:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Files

- `index.html` – UI and dashboard structure
- `style.css` – complete responsive styling
- `script.js` – CSV parsing, analysis, filters, chart generation, insights and PNG export
