import React, { useState } from 'react';
import { Upload, Search, FileText, AlertCircle, FolderOpen, Download, RefreshCw, Folder } from 'lucide-react';
import './App.css';

function App() {
  // State management
  const [anchors, setAnchors] = useState({
    name: '',
    email: '',
    phone: '',
    aadhaar: '',
    pan: ''
  });
  
  const [inputMode, setInputMode] = useState('upload'); // 'upload' or 'folder'
  const [files, setFiles] = useState([]);
  const [folderPath, setFolderPath] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [fullResults, setFullResults] = useState(null);

  // Validation
  const hasAnyAnchor = Object.values(anchors).some(val => val.trim() !== '');
  const hasInput = inputMode === 'upload' ? files.length > 0 : folderPath.trim() !== '';
  const canScan = hasAnyAnchor && hasInput && !isScanning;

  // Handle anchor input changes
  const handleAnchorChange = (field, value) => {
    setAnchors(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  // Handle mode change
  const handleModeChange = (mode) => {
    setInputMode(mode);
    setError(null);
    if (mode === 'folder') {
      setFiles([]);
    } else {
      setFolderPath('');
    }
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    addFiles(selectedFiles);
  };

  // Handle drag and drop
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  };

  // Add files with validation
  const addFiles = (newFiles) => {
    const allowedExtensions = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'txt'];
    const validFiles = newFiles.filter(file => {
      const ext = file.name.split('.').pop().toLowerCase();
      return allowedExtensions.includes(ext);
    });

    if (validFiles.length !== newFiles.length) {
      setError('Some files were skipped (only PDF, DOCX, XLSX, CSV, TXT allowed)');
    }

    setFiles(prev => [...prev, ...validFiles]);
    setError(null);
  };

  // Remove file
  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Handle scan
  const handleScan = async () => {
    if (!canScan) return;

    setIsScanning(true);
    setError(null);
    setResults(null);

    try {
      // Prepare form data
      const formData = new FormData();
      
      // Add anchors
      Object.entries(anchors).forEach(([key, value]) => {
        if (value.trim()) {
          formData.append(key, value.trim());
        }
      });

      // Add files or folder path based on mode
      if (inputMode === 'upload') {
        files.forEach(file => {
          formData.append('files', file);
        });
      } else {
        formData.append('folder_path', folderPath.trim());
      }

      // Make API request
      const response = await fetch('http://localhost:8000/api/scan', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.error || 'Scan failed');
      }

      if (data.success) {
        setResults(data.results);
        setFullResults(data.full_results);
      } else {
        throw new Error(data.error || 'Unknown error');
      }

    } catch (err) {
      setError(err.message || 'Failed to connect to server');
    } finally {
      setIsScanning(false);
    }
  };

  // Download JSON report
  const handleDownloadReport = () => {
    if (!fullResults) return;

    const blob = new Blob([JSON.stringify(fullResults, null, 2)], { 
      type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pii_report_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Reset form
  const handleReset = () => {
    setAnchors({ name: '', email: '', phone: '', aadhaar: '', pan: '' });
    setFiles([]);
    setFolderPath('');
    setResults(null);
    setError(null);
    setFullResults(null);
  };

  // Get file icon
  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
      pdf: '📄',
      docx: '📝',
      doc: '📝',
      xlsx: '📊',
      xls: '📊',
      csv: '📈',
      txt: '📃'
    };
    return icons[ext] || '📄';
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <Search className="logo-icon" />
            <span className="logo-text">PII Discovery</span>
          </div>
          <p className="tagline">Enterprise-grade personal information discovery system</p>
        </div>
      </header>

      <main className="main">
        <div className="container">
          
          {/* Show form if no results */}
          {!results ? (
            <>
              {/* Search Form */}
              <section className="section search-section">
                <div className="section-header">
                  <h2 className="section-title">Search Parameters</h2>
                  <p className="section-subtitle">
                    Provide at least one identifier to discover PII
                  </p>
                </div>

                <div className="input-grid">
                  <div className="input-group">
                    <label className="input-label">Full Name</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g., John Doe"
                      value={anchors.name}
                      onChange={(e) => handleAnchorChange('name', e.target.value)}
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">Email Address</label>
                    <input
                      type="email"
                      className="input-field"
                      placeholder="e.g., john@example.com"
                      value={anchors.email}
                      onChange={(e) => handleAnchorChange('email', e.target.value)}
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">Phone Number</label>
                    <input
                      type="tel"
                      className="input-field"
                      placeholder="e.g., 9876543210"
                      value={anchors.phone}
                      onChange={(e) => handleAnchorChange('phone', e.target.value)}
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">Aadhaar Number</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g., 1234 5678 9012"
                      value={anchors.aadhaar}
                      onChange={(e) => handleAnchorChange('aadhaar', e.target.value)}
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">PAN Number</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g., ABCDE1234F"
                      value={anchors.pan}
                      onChange={(e) => handleAnchorChange('pan', e.target.value)}
                    />
                  </div>
                </div>

                {!hasAnyAnchor && (
                  <div className="warning">
                    <AlertCircle size={16} />
                    <span>At least one identifier is required</span>
                  </div>
                )}
              </section>

              {/* Input Mode Selection */}
              <section className="section mode-section">
                <div className="section-header">
                  <h2 className="section-title">Select Input Mode</h2>
                  <p className="section-subtitle">
                    Choose to upload files or scan a folder path
                  </p>
                </div>

                <div className="mode-selector">
                  <button
                    className={`mode-btn ${inputMode === 'upload' ? 'mode-btn-active' : ''}`}
                    onClick={() => handleModeChange('upload')}
                  >
                    <Upload size={20} />
                    <span>Upload Files</span>
                  </button>
                  <button
                    className={`mode-btn ${inputMode === 'folder' ? 'mode-btn-active' : ''}`}
                    onClick={() => handleModeChange('folder')}
                  >
                    <FolderOpen size={20} />
                    <span>Folder Path</span>
                  </button>
                </div>
              </section>

              {/* File Upload or Folder Path */}
              {inputMode === 'upload' ? (
                <section className="section upload-section">
                  <div className="section-header">
                    <h2 className="section-title">Upload Files</h2>
                    <p className="section-subtitle">
                      Drag & drop or click to select files (PDF, DOCX, XLSX, CSV, TXT)
                    </p>
                  </div>

                  <div
                    className={`dropzone ${isDragging ? 'dropzone-active' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById('fileInput').click()}
                  >
                    <Upload className="dropzone-icon" />
                    <p className="dropzone-text">
                      {isDragging ? 'Drop files here' : 'Drag files here or click to browse'}
                    </p>
                    <input
                      id="fileInput"
                      type="file"
                      multiple
                      accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt"
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />
                  </div>

                  {files.length > 0 && (
                    <div className="file-list">
                      {files.map((file, index) => (
                        <div key={index} className="file-item">
                          <span className="file-icon">{getFileIcon(file.name)}</span>
                          <span className="file-name">{file.name}</span>
                          <span className="file-size">
                            {(file.size / 1024).toFixed(1)} KB
                          </span>
                          <button
                            className="file-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFile(index);
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : (
                <section className="section folder-section">
                  <div className="section-header">
                    <h2 className="section-title">Folder Path</h2>
                    <p className="section-subtitle">
                      Enter the full path to the folder you want to scan
                    </p>
                  </div>

                  <div className="folder-input-wrapper">
                    <Folder className="folder-input-icon" />
                    <input
                      type="text"
                      className="folder-input"
                      placeholder="e.g., /home/user/documents or C:\Users\Documents"
                      value={folderPath}
                      onChange={(e) => {
                        setFolderPath(e.target.value);
                        setError(null);
                      }}
                    />
                  </div>

                  <div className="folder-help">
                    <p><strong>Examples:</strong></p>
                    <ul>
                      <li>Linux/Mac: <code>/home/user/documents</code></li>
                      <li>Windows: <code>C:\Users\YourName\Documents</code></li>
                      <li>Network: <code>\\server\share\folder</code></li>
                    </ul>
                    <p className="folder-note">
                      <AlertCircle size={14} />
                      The server must have read access to this folder
                    </p>
                  </div>
                </section>
              )}

              {/* Error Message */}
              {error && (
                <div className="error-message">
                  <AlertCircle size={20} />
                  <span>{error}</span>
                </div>
              )}

              {/* Scan Button */}
              <div className="action-bar">
                <button
                  className={`btn btn-primary ${!canScan ? 'btn-disabled' : ''}`}
                  onClick={handleScan}
                  disabled={!canScan}
                >
                  {isScanning ? (
                    <>
                      <RefreshCw className="btn-icon spinning" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Search className="btn-icon" />
                      Scan for PII
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            /* Results Display */
            <section className="section results-section">
              <div className="results-header">
                <div>
                  <h2 className="section-title">Scan Results</h2>
                  <p className="section-subtitle">
                    {results.files_found === 0
                      ? 'No PII found in scanned location'
                      : `Found PII in ${results.files_found} file${results.files_found > 1 ? 's' : ''}`
                    }
                  </p>
                </div>
                <div className="results-actions">
                  {fullResults && (
                    <button className="btn btn-secondary" onClick={handleDownloadReport}>
                      <Download className="btn-icon" />
                      Download Report
                    </button>
                  )}
                  <button className="btn btn-primary" onClick={handleReset}>
                    <RefreshCw className="btn-icon" />
                    New Search
                  </button>
                </div>
              </div>

              {results.files_found === 0 ? (
                <div className="empty-state">
                  <FileText size={48} />
                  <p>No PII matching the provided identifiers was found.</p>
                </div>
              ) : (
                <div className="results-list">
                  {results.pii_instances.map((instance, index) => (
                    <div key={index} className="result-card">
                      <div className="result-header">
                        <FileText className="result-icon" />
                        <span className="result-filename">{instance.file}</span>
                      </div>
                      <div className="result-body">
                        <p className="result-label">PII Types Found:</p>
                        <div className="pii-tags">
                          {instance.pii_types.map((type, i) => (
                            <span key={i} className="pii-tag">{type}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>PII Discovery System v2.0 • FastAPI + React • Enterprise-grade privacy compliance tool</p>
      </footer>
    </div>
  );
}

export default App;
