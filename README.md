# DataLens — Data Quality Analyzer

## About the Project

DataLens is a web-based data quality analysis and cleaning application. It helps users upload CSV datasets, analyze data quality, identify missing values and duplicate records, clean data, and generate downloadable reports.

The project provides an interactive interface to make data quality assessment easier and more understandable.

## Features

- **CSV Upload:** Upload CSV files for analysis.
- **Dataset Analysis:** View the number of rows, columns, missing values, and duplicate rows.
- **Data Quality Score:** Calculate a project-defined data quality score.
- **Column Quality:** View column types, missing values, and unique values.
- **Data Visualization:** Explore data insights using charts and metrics.
- **Data Cleaning:** Handle missing numerical values using median or mean imputation, or use mode imputation where applicable.
- **Duplicate Removal:** Remove exact duplicate rows.
- **Cleaning Comparison:** Compare data quality before and after cleaning.
- **JSON Export:** Export analysis results as a JSON report.
- **PDF Export:** Download a PDF report.
- **Input Validation:** Handle empty files, invalid CSV files, and unsupported file formats.

## Technology Stack

### Frontend
- React
- Vite
- CSS
- JavaScript

### Backend
- Python
- Flask
- Flask-CORS
- Pandas
- NumPy

## Project Structure

```text
DataLens/
├── frontend/
│   ├── src/
│   ├── package.json
│   └── README.md
├── backend/
│   └── app.py
└── README.md
```

*Note: The structure above shows the main project files. Additional files may exist in the project.*

## Installation and Setup

### Prerequisites

Install the following software:

- Node.js and npm
- Python
- pip

### 1. Start the Backend

Open a terminal in the project root directory and run:

```powershell
cd backend
python -m pip install flask flask-cors pandas numpy
python app.py
```

The Flask backend runs at:

`http://127.0.0.1:5000`

To check the backend health, open:

`http://127.0.0.1:5000/api/health`

Keep this terminal running.

### 2. Start the Frontend

Open a **second terminal** in VS Code and run:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL displayed in the terminal to use DataLens.

## How to Use

1. Start the backend and frontend.
2. Open the DataLens application in your browser.
3. Upload a valid CSV file.
4. Analyze the dataset.
5. Review data quality metrics, charts, and cleaning suggestions.
6. Choose an available cleaning method.
7. Compare the original and cleaned dataset.
8. Export the analysis report as JSON or PDF.

## Data Quality Metrics

DataLens evaluates several aspects of a dataset:

- **Completeness:** Percentage of cells containing values.
- **Uniqueness:** Percentage of rows remaining after accounting for exact duplicate rows.
- **Consistency:** Validation of numeric-like values using the implemented parsing rules.
- **Quality Score:** A project-defined score based on missing-cell and duplicate-row penalties.

These metrics are intended for educational and analytical use. They do not guarantee that every