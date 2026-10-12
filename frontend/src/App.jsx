import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import './App.css'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000'

function Section({ title, subtitle, children, className = '' }) {
  return (
    <section className={`table-card ${className}`}>
      <h3>{title}</h3>
      {subtitle && <p className="table-subtitle">{subtitle}</p>}
      {children}
    </section>
  )
}

function DownloadButton({ onClick, children }) {
  return (
    <button className="analyze-btn download-btn" onClick={onClick}>
      {children}
    </button>
  )
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeName(name) {
  return (name || 'dataset')
    .replace(/\.csv$/i, '')
    .replace(/[^a-z0-9_-]/gi, '_')
}

function number(value, fallback = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

function formatNumber(value) {
  return number(value).toLocaleString('en-IN')
}

function formatPercent(value) {
  return `${number(value).toFixed(2)}%`
}

function getColumnRows(data) {
  return (data?.column_quality || []).map((item) => ({
    column: item.column,
    dtype: item.dtype ?? item.data_type ?? 'Unknown',
    missing: number(item.missing ?? item.missing_values),
    missingPercent: number(item.missing_percent ?? item.missing_percentage),
    unique: number(item.unique ?? item.unique_values),
  }))
}

function getMetrics(data) {
  const source = data?.smart_metrics || {}

  return {
    completeness: number(source.completeness),
    uniqueness: number(source.uniqueness),
    consistency: number(source.consistency),
    checksPassed: source.consistency_checks_passed ?? null,
    checksTotal: source.consistency_checks ?? null,
    issues: source.consistency_issues || [],
    note: source.consistency_note || '',
  }
}

function MetricCard({ title, value, description, color }) {
  const score = number(value)

  return (
    <article className="stat-card metric-card">
      <p>{title}</p>
      <strong style={{ color }}>{score.toFixed(1)}%</strong>
      <div className="metric-track" aria-label={`${title}: ${score}%`}>
        <span
          style={{
            width: `${Math.max(0, Math.min(100, score))}%`,
            background: color,
          }}
        />
      </div>
      <small>{description}</small>
    </article>
  )
}

function getQualityLabel(score) {
  if (score >= 90) return 'Excellent'
  if (score >= 75) return 'Good'
  if (score >= 50) return 'Needs improvement'
  return 'Needs attention'
}

function getInsights(data, metrics, columns, outliers) {
  const insights = []
  const totalCells = number(data?.rows) * number(data?.columns)
  const missing = number(data?.missing_values)
  const duplicates = number(data?.duplicate_rows)

  if (missing > 0) {
    insights.push({
      type: 'warning',
      title: `${formatNumber(missing)} missing value(s)`,
      text: totalCells
        ? `${formatPercent((missing / totalCells) * 100)} of all cells are empty. Review imputation options before cleaning.`
        : 'Review missing values before analysis.',
    })
  } else {
    insights.push({
      type: 'success',
      title: 'No missing values',
      text: 'The dataset has no missing cells in the current analysis.',
    })
  }

  if (duplicates > 0) {
    insights.push({
      type: 'warning',
      title: `${formatNumber(duplicates)} duplicate row(s)`,
      text: 'Review repeated records before removing them.',
    })
  } else {
    insights.push({
      type: 'success',
      title: 'No exact duplicate rows',
      text: 'No repeated full rows were detected.',
    })
  }

  if (metrics.issues.length > 0) {
    insights.push({
      type: 'warning',
      title: `${metrics.issues.length} consistency issue type(s)`,
      text: 'Review flagged values in the consistency table.',
    })
  } else {
    insights.push({
      type: 'info',
      title: 'No consistency issues flagged',
      text: 'This only reflects the validation rules implemented in DataLens.',
    })
  }

  const unusual = outliers.reduce(
    (sum, item) => sum + number(item.outlier_count),
    0
  )

  if (unusual > 0) {
    insights.push({
      type: 'info',
      title: `${formatNumber(unusual)} potential outlier(s)`,
      text: 'Outliers may be legitimate values. Investigate them before changing the data.',
    })
  }

  const mostMissing = [...columns].sort((a, b) => b.missing - a.missing)[0]

  if (mostMissing?.missing > 0) {
    insights.push({
      type: 'info',
      title: `Review ${mostMissing.column}`,
      text: `This column has the highest number of missing values (${mostMissing.missing}).`,
    })
  }

  return insights
}

function App() {
  const [activeTab, setActiveTab] = useState('Overview')
  const [file, setFile] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState('')
  const [cleanError, setCleanError] = useState('')
  const [method, setMethod] = useState('median')
  const [removeDuplicates, setRemoveDuplicates] = useState(true)
  const [cleanSummary, setCleanSummary] = useState(null)
  const [search, setSearch] = useState('')
  const [previewLimit, setPreviewLimit] = useState(10)

  const columns = useMemo(() => getColumnRows(data), [data])
  const metrics = useMemo(() => getMetrics(data), [data])
  const outliers = useMemo(
    () => data?.outliers || data?.outlier_results || [],
    [data]
  )
  const suggestions = data?.cleaning_suggestions || []
  const preview = useMemo(() => data?.preview || [], [data])
  const columnNames = data?.column_names || columns.map((item) => item.column)

  const filteredPreview = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return preview

    return preview.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? '').toLowerCase().includes(query)
      )
    )
  }, [preview, search])

  const insights = useMemo(
    () => getInsights(data, metrics, columns, outliers),
    [data, metrics, columns, outliers]
  )

  async function analyzeFile() {
    if (!file) {
      setError('Please choose a CSV file first.')
      return
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file.')
      return
    }

    if (file.size > 16 * 1024 * 1024) {
      setError('File size must be less than 16 MB.')
      return
    }

    setLoading(true)
    setError('')
    setCleanError('')
    setData(null)
    setCleanSummary(null)
    setPreviewLimit(10)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(`${API}/api/upload`, {
        method: 'POST',
        body: formData,
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to analyse this CSV.')
      }

      setData(result)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Cannot connect to Flask. Check that the backend is running.'
      )
    } finally {
      setLoading(false)
    }
  }

  function exportJSON() {
    if (!data) return

    const report = {
      title: 'DataLens Data Quality Report',
      generated_at: new Date().toISOString(),
      dataset: data,
      insights,
      cleaning_comparison: cleanSummary,
      metric_definitions: {
        completeness: 'Non-missing cells / total cells × 100',
        uniqueness: 'Rows remaining after exact duplicate removal / total rows × 100',
        consistency: 'Passed implemented validation checks / total checks × 100',
        quality_score: 'Project-defined score based on missing-cell and duplicate-row penalties',
      },
      note: 'Potential outliers should be reviewed before removal.',
    }

    downloadBlob(
      JSON.stringify(report, null, 2),
      'application/json;charset=utf-8',
      `DataLens_Report_${safeName(data.filename)}.json`
    )
  }

  function exportPDF() {
    if (!data) return

    const pdf = new jsPDF({ orientation: 'landscape' })

    pdf.setFontSize(22)
    pdf.text('DataLens', 14, 18)
    pdf.setFontSize(12)
    pdf.text('Data Quality Analysis Report', 14, 26)
    pdf.setFontSize(10)
    pdf.text(`Dataset: ${data.filename || file?.name || 'CSV file'}`, 14, 35)
    pdf.text(`Generated: ${new Date().toLocaleString()}`, 14, 41)

    autoTable(pdf, {
      startY: 48,
      head: [['Metric', 'Value']],
      body: [
        ['Total rows', data.rows ?? 0],
        ['Total columns', data.columns ?? columns.length],
        ['Quality score', `${data.quality_score ?? 0}/100`],
        ['Missing values', data.missing_values ?? 0],
        ['Duplicate rows', data.duplicate_rows ?? 0],
        ['Completeness', formatPercent(metrics.completeness)],
        ['Uniqueness', formatPercent(metrics.uniqueness)],
        ['Consistency estimate', formatPercent(metrics.consistency)],
      ],
      theme: 'grid',
    })

    autoTable(pdf, {
      startY: pdf.lastAutoTable.finalY + 8,
      head: [['Column', 'Data type', 'Missing', 'Missing %', 'Unique values']],
      body: columns.map((item) => [
        item.column,
        item.dtype,
        item.missing,
        formatPercent(item.missingPercent),
        item.unique,
      ]),
      theme: 'striped',
    })

    autoTable(pdf, {
      startY: pdf.lastAutoTable.finalY + 8,
      head: [['Column', 'Outliers', 'Lower bound', 'Upper bound']],
      body: outliers.map((item) => [
        item.column,
        item.outlier_count ?? 0,
        item.lower_bound ?? 'N/A',
        item.upper_bound ?? 'N/A',
      ]),
      theme: 'grid',
    })

    if (metrics.issues.length) {
      autoTable(pdf, {
        startY: pdf.lastAutoTable.finalY + 8,
        head: [['Column', 'Issue', 'Count', 'Details']],
        body: metrics.issues.map((item) => [
          item.column || '',
          item.issue || '',
          item.count ?? 0,
          item.details || '',
        ]),
        theme: 'striped',
      })
    }

    if (suggestions.length) {
      autoTable(pdf, {
        startY: pdf.lastAutoTable.finalY + 8,
        head: [['Issue', 'Column', 'Count', 'Suggestion']],
        body: suggestions.map((item) => [
          item.issue || 'Review',
          item.column || 'Dataset',
          item.count ?? 0,
          item.suggestion || '',
        ]),
        theme: 'striped',
      })
    }

    if (cleanSummary) {
      autoTable(pdf, {
        startY: pdf.lastAutoTable.finalY + 8,
        head: [['Cleaning comparison', 'Original', 'Cleaned']],
        body: [
          ['Rows', cleanSummary.originalRows, cleanSummary.cleanedRows],
          ['Missing values', cleanSummary.originalMissing, cleanSummary.remainingMissing],
          ['Duplicate rows', cleanSummary.originalDuplicates, cleanSummary.remainingDuplicates],
          ['Quality score', cleanSummary.originalQuality, cleanSummary.cleanedQuality],
          ['Completeness (%)', cleanSummary.originalCompleteness, cleanSummary.cleanedCompleteness],
          ['Uniqueness (%)', cleanSummary.originalUniqueness, cleanSummary.cleanedUniqueness],
          ['Consistency (%)', cleanSummary.originalConsistency, cleanSummary.cleanedConsistency],
        ],
        theme: 'grid',
      })
    }

    const pageCount = pdf.getNumberOfPages()
    for (let page = 1; page <= pageCount; page++) {
      pdf.setPage(page)
      pdf.setFontSize(8)
      pdf.text(
        `DataLens | Page ${page} of ${pageCount}`,
        14,
        pdf.internal.pageSize.getHeight() - 7
      )
    }

    pdf.save(`DataLens_Report_${safeName(data.filename)}.pdf`)
  }

  async function cleanAndDownload() {
    if (!file) {
      setCleanError('Please select a CSV file first.')
      return
    }

    setCleaning(true)
    setCleanError('')
    setCleanSummary(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('method', method)
    formData.append('remove_duplicates', String(removeDuplicates))

    try {
      const response = await fetch(`${API}/api/clean`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Unable to clean the dataset.')
      }

      const csv = await response.text()
      const readHeader = (name) => response.headers.get(name)

      const summary = {
        originalRows: number(readHeader('X-Original-Rows')),
        cleanedRows: number(readHeader('X-Cleaned-Rows')),
        originalMissing: number(readHeader('X-Original-Missing')),
        remainingMissing: number(readHeader('X-Remaining-Missing')),
        originalDuplicates: number(readHeader('X-Original-Duplicates')),
        remainingDuplicates: number(readHeader('X-Remaining-Duplicates')),
        originalQuality: number(readHeader('X-Original-Quality')),
        cleanedQuality: number(readHeader('X-Cleaned-Quality')),
        originalCompleteness: number(readHeader('X-Original-Completeness')),
        cleanedCompleteness: number(readHeader('X-Cleaned-Completeness')),
        originalUniqueness: number(readHeader('X-Original-Uniqueness')),
        cleanedUniqueness: number(readHeader('X-Cleaned-Uniqueness')),
        originalConsistency: number(readHeader('X-Original-Consistency')),
        cleanedConsistency: number(readHeader('X-Cleaned-Consistency')),
        cleaningMethod: readHeader('X-Cleaning-Method') || method,
        duplicatesRemoved: number(readHeader('X-Duplicates-Removed')),
      }

      downloadBlob(
        '\uFEFF' + csv,
        'text/csv;charset=utf-8',
        `DataLens_Cleaned_${safeName(file.name)}.csv`
      )

      setCleanSummary(summary)
    } catch (err) {
      setCleanError(
        err instanceof Error ? err.message : 'Could not connect to the backend.'
      )
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span>✦</span> DataLens</div>
        <p className="side-label">WORKSPACE</p>

        <button
          type="button"
          className={`nav-item ${activeTab === 'Overview' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('Overview')
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        >
          ▦ &nbsp; Overview
        </button>
        <button
          type="button"
          className={`nav-item ${activeTab === 'Data Quality' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('Data Quality')
            document.getElementById('data-quality')?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            })
          }}
        >
          ⌁ &nbsp; Data Quality
        </button>
        


<button
  type="button"
  className={`nav-item ${activeTab === 'Reports' ? 'active' : ''}`}
  onClick={() => {
    setActiveTab('Reports')

    const reportSection = document.getElementById('reports')

    if (reportSection) {
      reportSection.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    } else {
      alert(
        'Please upload and analyze a dataset first to access Reports.'
      )

      document.querySelector('.upload-card')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }}
>
  ▤ &nbsp; Reports
</button>



        <div className="sidebar-bottom">Your data, made clearer.</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <span>Workspace / Overview</span>
          <span className="status"><i /> DataLens workspace</span>
        </header>

        <section className="welcome">
          <p className="eyebrow">INTELLIGENT DATA ANALYSIS</p>
          <h1>Make your data <span>make sense.</span></h1>
          <p className="subtitle">
            Analyse data quality, identify issues, and prepare cleaner datasets.
          </p>
        </section>

        <section className="upload-card">
          <div className="upload-icon">↑</div>
          <h2>Upload your dataset</h2>
          <p>Choose a CSV file to start your analysis.</p>

          <label className="file-picker">
            {file ? `✓ ${file.name}` : 'Choose CSV file'}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null)
                setData(null)
                setError('')
                setCleanError('')
                setCleanSummary(null)
                setSearch('')
                setPreviewLimit(10)
              }}
            />
          </label>

          <p className="file-hint">CSV format · Maximum size 16 MB</p>

          <button
            className="analyze-btn"
            onClick={analyzeFile}
            disabled={loading}
          >
            {loading ? 'Analysing dataset...' : 'Analyse dataset →'}
          </button>

          {error && <p className="error">{error}</p>}
        </section>

        {data && (
          <section className="results" id="data-quality">
            <div className="results-heading">
              <div>
                <p className="eyebrow">ANALYSIS RESULTS</p>
                <h2>{data.filename || file?.name}</h2>
                <p className="table-subtitle">Your dataset quality report is ready.</p>
              </div>
              <div className="report-actions" id="reports">
                <DownloadButton onClick={exportJSON}>↓ JSON Report</DownloadButton>
                <DownloadButton onClick={exportPDF}>↓ PDF Report</DownloadButton>
              </div>
            </div>

            <div className="stats-grid overview-grid">
              <article className="stat-card quality-score-card">
                <p>Quality score</p>
                <strong>{number(data.quality_score)}<small>/100</small></strong>
                <span className="quality-label">
                  {getQualityLabel(number(data.quality_score))}
                </span>
              </article>
              <article className="stat-card">
                <p>Total rows</p>
                <strong>{formatNumber(data.rows)}</strong>
                <small>Records in your dataset</small>
              </article>
              <article className="stat-card">
                <p>Missing values</p>
                <strong>{formatNumber(data.missing_values)}</strong>
                <small>Empty cells to review</small>
              </article>
              <article className="stat-card">
                <p>Duplicate rows</p>
                <strong>{formatNumber(data.duplicate_rows)}</strong>
                <small>Repeated complete records</small>
              </article>
            </div>

            <Section
              title="Smart Data Quality Dashboard"
              subtitle="These indicators summarise the checks implemented in this project."
            >
              <div className="stats-grid">
                <MetricCard
                  title="Completeness"
                  value={metrics.completeness}
                  description="Percentage of cells that are not missing."
                  color="#239b83"
                />
                <MetricCard
                  title="Uniqueness"
                  value={metrics.uniqueness}
                  description="Percentage of rows remaining after exact duplicate removal."
                  color="#6478d8"
                />
                <MetricCard
                  title="Consistency"
                  value={metrics.consistency}
                  description="Estimated consistency based on implemented validation checks."
                  color="#d98543"
                />
              </div>
              {metrics.checksTotal !== null && (
                <p className="table-subtitle">
                  Validation checks passed: {formatNumber(metrics.checksPassed)} of {formatNumber(metrics.checksTotal)}
                </p>
              )}
              {metrics.note && <p className="table-subtitle">{metrics.note}</p>}
            </Section>

            <Section
              title="Data Quality Insights"
              subtitle="Automatic observations based on the current analysis."
            >
              <div className="insight-grid">
                {insights.map((item, index) => (
                  <article className={`insight-card ${item.type}`} key={`${item.title}-${index}`}>
                    <span className="insight-dot" />
                    <h4>{item.title}</h4>
                    <p>{item.text}</p>
                  </article>
                ))}
              </div>
            </Section>

            <Section
              title="Column-wise Data Quality"
              subtitle="Inspect data types, missing values, and distinct values for each column."
            >
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Data type</th>
                      <th>Missing</th>
                      <th>Missing %</th>
                      <th>Unique values</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((item) => (
                      <tr key={item.column}>
                        <td>{item.column}</td>
                        <td>{item.dtype}</td>
                        <td>{item.missing}</td>
                        <td>{formatPercent(item.missingPercent)}</td>
                        <td>{item.unique}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <div className="chart-grid">
              <Section title="Missing Values by Column">
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={columns.map((item) => ({
                        name: item.column,
                        missing: item.missing,
                      }))}
                      margin={{ top: 10, right: 12, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="missing" name="Missing values" fill="#df8966" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>

              <Section title="Unique Values by Column">
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={columns.map((item) => ({
                        name: item.column,
                        unique: item.unique,
                      }))}
                      margin={{ top: 10, right: 12, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="unique" name="Unique values" fill="#7186d8" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>
            </div>

            <Section
              title="Consistency Issues"
              subtitle="Review issues flagged by the implemented checks."
            >
              {metrics.issues.length === 0 ? (
                <p>No consistency issues were flagged by the current checks.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Column</th><th>Issue</th><th>Details</th><th>Count</th><th>Examples</th></tr>
                    </thead>
                    <tbody>
                      {metrics.issues.map((item, index) => (
                        <tr key={`${item.column}-${item.issue}-${index}`}>
                          <td>{item.column}</td>
                          <td>{item.issue}</td>
                          <td>{item.details}</td>
                          <td>{item.count}</td>
                          <td>{(item.examples || []).join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {metrics.note && <p className="table-subtitle">{metrics.note}</p>}
            </Section>

            <Section
              title="Outlier Detection"
              subtitle="Potentially unusual numeric values identified using the IQR method. Outliers are not automatically removed."
            >
              {outliers.length === 0 ? (
                <p>No outlier results are available for this dataset.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Outlier count</th>
                        <th>Lower bound</th>
                        <th>Upper bound</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outliers.map((item) => (
                        <tr key={item.column}>
                          <td>{item.column}</td>
                          <td>{item.outlier_count ?? 0}</td>
                          <td>{item.lower_bound ?? 'N/A'}</td>
                          <td>{item.upper_bound ?? 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section
              title="Data Cleaning Suggestions"
              subtitle="Review recommendations before changing your data."
            >
              {suggestions.length === 0 ? (
                <p>No cleaning suggestions were generated by the current checks.</p>
              ) : (
                <div className="suggestion-list">
                  {suggestions.map((item, index) => (
                    <article className="suggestion-item" key={`${item.issue}-${item.column}-${index}`}>
                      <span className="suggestion-tag">{item.issue}</span>
                      <h4>{item.column || 'Entire dataset'}</h4>
                      <p>{item.suggestion}</p>
                      <span>{item.count ?? 0} flagged item(s)</span>
                    </article>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Apply Data Cleaning"
              subtitle="Cleaning creates a separate download. Your original CSV is not modified."
            >
              <div className="cleaning-controls">
                <label htmlFor="missing-method">Missing value method</label>
                <select
                  id="missing-method"
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                >
                  <option value="median">Median (numeric columns)</option>
                  <option value="mean">Mean (numeric columns)</option>
                  <option value="mode">Mode (most frequent value)</option>
                  <option value="none">Do not fill missing values</option>
                </select>

                <label className="duplicate-option">
                  <input
                    type="checkbox"
                    checked={removeDuplicates}
                    onChange={(event) => setRemoveDuplicates(event.target.checked)}
                  />
                  Remove exact duplicate rows
                </label>

                <button
                  className="analyze-btn clean-btn"
                  onClick={cleanAndDownload}
                  disabled={cleaning}
                >
                  {cleaning ? 'Cleaning dataset...' : 'Clean & Download CSV ↓'}
                </button>

                {cleanError && <p className="error">{cleanError}</p>}

                {cleanSummary && (
                  <>
                    <h4>Original vs. cleaned dataset</h4>
                    <p className="table-subtitle">
                      Method: {cleanSummary.cleaningMethod}. Duplicate rows removed: {cleanSummary.duplicatesRemoved}.
                    </p>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr><th>Metric</th><th>Original</th><th>Cleaned</th><th>Change</th></tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Rows</td>
                            <td>{cleanSummary.originalRows}</td>
                            <td>{cleanSummary.cleanedRows}</td>
                            <td>{cleanSummary.cleanedRows - cleanSummary.originalRows}</td>
                          </tr>
                          <tr>
                            <td>Missing values</td>
                            <td>{cleanSummary.originalMissing}</td>
                            <td>{cleanSummary.remainingMissing}</td>
                            <td>{cleanSummary.remainingMissing - cleanSummary.originalMissing}</td>
                          </tr>
                          <tr>
                            <td>Duplicate rows</td>
                            <td>{cleanSummary.originalDuplicates}</td>
                            <td>{cleanSummary.remainingDuplicates}</td>
                            <td>{cleanSummary.remainingDuplicates - cleanSummary.originalDuplicates}</td>
                          </tr>
                          <tr>
                            <td>Quality score</td>
                            <td>{cleanSummary.originalQuality}/100</td>
                            <td>{cleanSummary.cleanedQuality}/100</td>
                            <td>{(cleanSummary.cleanedQuality - cleanSummary.originalQuality).toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td>Completeness</td>
                            <td>{formatPercent(cleanSummary.originalCompleteness)}</td>
                            <td>{formatPercent(cleanSummary.cleanedCompleteness)}</td>
                            <td>{(cleanSummary.cleanedCompleteness - cleanSummary.originalCompleteness).toFixed(2)}%</td>
                          </tr>
                          <tr>
                            <td>Uniqueness</td>
                            <td>{formatPercent(cleanSummary.originalUniqueness)}</td>
                            <td>{formatPercent(cleanSummary.cleanedUniqueness)}</td>
                            <td>{(cleanSummary.cleanedUniqueness - cleanSummary.originalUniqueness).toFixed(2)}%</td>
                          </tr>
                          <tr>
                            <td>Consistency</td>
                            <td>{formatPercent(cleanSummary.originalConsistency)}</td>
                            <td>{formatPercent(cleanSummary.cleanedConsistency)}</td>
                            <td>{(cleanSummary.cleanedConsistency - cleanSummary.originalConsistency).toFixed(2)}%</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="table-subtitle">
                      The comparison uses the backend's implemented metrics. Review changes before using the cleaned file.
                    </p>
                  </>
                )}
              </div>
            </Section>

            <Section
              title="Dataset Preview"
              subtitle={`Showing ${Math.min(previewLimit, filteredPreview.length)} of ${filteredPreview.length} matching row(s) returned by the backend.`}
            >
              <input
                className="preview-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search visible rows..."
                aria-label="Search dataset preview"
              />

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>{columnNames.map((column) => <th key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {filteredPreview.slice(0, previewLimit).map((row, index) => (
                      <tr key={index}>
                        {columnNames.map((column) => (
                          <td key={column}>
                            {row[column] == null || row[column] === ''
                              ? 'Missing'
                              : String(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredPreview.length > previewLimit && (
                <button
                  className="analyze-btn"
                  onClick={() => setPreviewLimit((current) => current + 10)}
                >
                  Show more rows
                </button>
              )}

              {filteredPreview.length === 0 && <p>No matching rows found in the visible preview.</p>}
            </Section>

            <p className="table-subtitle">
              Note: Search and preview operate on rows returned by the backend, not necessarily the entire dataset. Consistency and quality scores reflect the project's implemented checks.
            </p>
          </section>
        )}
      </main>
    </div>
  )
}

export default App