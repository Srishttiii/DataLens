# DataLens — Data Analysis & Quality Dashboard
🌐 **Live Demo:** https://data-lens-mauve.vercel.app/

🚀 **Live Backend:** https://datalens-ib7j.onrender.com/api/health

DataLens is a web-based data analysis dashboard designed to help users explore CSV datasets, identify data quality issues, clean data, and generate reports through a simple and interactive interface.

## Features

- **CSV Upload & Analysis:** Upload CSV files and explore dataset information.
- **Data Overview:** View key metrics and visualizations to understand your data.
- **Data Quality Checks:** Identify missing values and duplicate records.
- **Data Cleaning:** Handle missing values using median imputation and remove duplicate records.
- **Interactive Dashboard:** Navigate between Overview, Data Quality, and Reports.
- **Report Export:** Export analysis results in JSON and PDF formats.
- **Input Validation:** Reject empty CSV files and provide a better data-processing workflow.

## Tech Stack

**Frontend**
- React
- Vite
- JavaScript
- CSS

**Backend**
- Python
- Flask

**Data Processing**
- CSV-based data analysis and cleaning

## Project Structure

```text
DataLens/
├── backend/
│   └── app.py
├── frontend/
│   ├── src/
│   ├── public/
│   └── package.json
├── sample_data.csv
├── README.md
└── .gitignore
```

## Getting Started

### Prerequisites

- Python
- Node.js and npm
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/Srishttiii/DataLens.git
cd DataLens
```

### 2. Start the Backend

Activate your Python virtual environment if you have one, install the backend dependencies from the project's dependency file, and start the Flask application.

```bash
python app.py
```

Run this command from the `backend` directory.

### 3. Start the Frontend

Open a separate terminal and run:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL displayed by Vite in your terminal.

**Note:** Backend dependencies and configuration must be set up before running the application. Follow the project's existing dependency and configuration files.

## Use Cases

- Exploring structured CSV datasets
- Identifying missing and duplicate records
- Performing basic data cleaning
- Reviewing data quality
- Exporting analysis results for further use

## Future Improvements

- Support for additional dataset formats
- More advanced data quality metrics
- Additional visualization options
- Enhanced report customization

## Author

Developed as an academic project to explore data analysis, data quality assessment, and interactive dashboard development.

## License

No license has been specified yet.

These metrics are intended for educational and analytical use. They do not guarantee that every
