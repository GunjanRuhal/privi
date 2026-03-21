"""
FastAPI Backend for PII Discovery Web Application
High-performance async API with modern features
"""

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from typing import List, Optional
import os
import json
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
import traceback
import asyncio
from pydantic import BaseModel

# Import the PII discovery engine
from pii_discovery_v2 import discover_pii

# ============================================================================
# FASTAPI APP INITIALIZATION
# ============================================================================

app = FastAPI(
    title="PII Discovery API",
    description="Enterprise-grade PII discovery and clustering engine",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",  # Vite default port
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# CONFIGURATION
# ============================================================================

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_EXTENSIONS = {'pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'txt'}
UPLOAD_DIR = tempfile.mkdtemp()

# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: str
    upload_dir: str

class ScanRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    aadhaar: Optional[str] = None
    pan: Optional[str] = None

class PIIInstance(BaseModel):
    file: str
    pii_types: List[str]

class ScanResponse(BaseModel):
    success: bool
    files_found: int
    pii_instances: List[PIIInstance]
    statistics: dict
    confidence: float
    confidence_level: str

class ErrorResponse(BaseModel):
    success: bool
    error: str
    detail: Optional[str] = None

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def allowed_file(filename: str) -> bool:
    """Check if file extension is allowed"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

async def cleanup_temp_directory(directory: str):
    """Clean up temporary directory after processing"""
    try:
        if os.path.exists(directory):
            await asyncio.to_thread(shutil.rmtree, directory)
    except Exception as e:
        print(f"[CLEANUP ERROR] {str(e)}")

def validate_anchors(anchors: dict) -> tuple[bool, Optional[str]]:
    """Validate that at least one anchor is provided"""
    if not anchors:
        return False, "At least one identifier must be provided"
    
    # Check that at least one anchor has a value
    has_value = any(value and str(value).strip() for value in anchors.values())
    if not has_value:
        return False, "At least one identifier must have a value"
    
    return True, None

def format_results_for_frontend(results: dict) -> dict:
    """Format PII discovery results for frontend consumption"""
    
    if not results or 'detailed_instances' not in results:
        return {
            'files_found': 0,
            'pii_instances': [],
            'statistics': {},
            'confidence': 0,
            'confidence_level': 'UNKNOWN'
        }
    
    # Extract simplified results
    pii_instances = []
    for file_data in results['detailed_instances']:
        pii_instances.append({
            'file': file_data['file'],
            'pii_types': sorted(list(file_data['pii_types'].keys()))
        })
    
    return {
        'files_found': len(pii_instances),
        'pii_instances': pii_instances,
        'statistics': results.get('statistics', {}),
        'confidence': results.get('cluster', {}).get('confidence', 0),
        'confidence_level': results.get('cluster', {}).get('confidence_level', 'UNKNOWN')
    }

def validate_folder_path(folder_path: str) -> tuple[bool, Optional[str]]:
    """Validate that folder path exists and is accessible"""
    if not folder_path or not folder_path.strip():
        return False, "Folder path is empty"
    
    path = Path(folder_path)
    
    if not path.exists():
        return False, f"Folder does not exist: {folder_path}"
    
    if not path.is_dir():
        return False, f"Path is not a directory: {folder_path}"
    
    if not os.access(path, os.R_OK):
        return False, f"No read permission for folder: {folder_path}"
    
    # Check if folder has any files
    try:
        files = list(path.rglob("*"))
        if not any(f.is_file() for f in files):
            return False, f"No files found in folder: {folder_path}"
    except Exception as e:
        return False, f"Error accessing folder: {str(e)}"
    
    return True, None

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint
    Returns server status and configuration
    """
    return HealthResponse(
        status="healthy",
        version="2.0.0",
        timestamp=datetime.now().isoformat(),
        upload_dir=UPLOAD_DIR
    )

@app.post("/api/scan")
async def scan_for_pii(
    background_tasks: BackgroundTasks,
    files: Optional[List[UploadFile]] = File(None),
    folder_path: Optional[str] = Form(None),
    name: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    aadhaar: Optional[str] = Form(None),
    pan: Optional[str] = Form(None)
):
    """
    Main endpoint: Scan uploaded files or folder for PII
    
    Accepts either:
    - files: List of uploaded files (multipart/form-data)
    - folder_path: Path to folder on server to scan
    
    Plus anchors: name, email, phone, aadhaar, pan (at least one required)
    
    Returns:
    - JSON with discovered PII organized by file
    """
    
    temp_dir = None
    scan_path = None
    
    try:
        # Collect anchors
        anchors = {}
        for anchor_type, value in [
            ('name', name), ('email', email), ('phone', phone),
            ('aadhaar', aadhaar), ('pan', pan)
        ]:
            if value and value.strip():
                anchors[anchor_type] = value.strip()
        
        # Validate anchors
        is_valid, error_msg = validate_anchors(anchors)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)
        
        # Determine scan mode: files or folder
        if folder_path and folder_path.strip():
            # FOLDER MODE
            is_valid_folder, folder_error = validate_folder_path(folder_path.strip())
            if not is_valid_folder:
                raise HTTPException(status_code=400, detail=folder_error)
            
            scan_path = folder_path.strip()
            print(f"\n[SCAN MODE] Folder: {scan_path}")
            
        elif files and len(files) > 0:
            # FILE UPLOAD MODE
            # Validate files provided
            if not any(f.filename for f in files):
                raise HTTPException(
                    status_code=400,
                    detail="No valid files selected"
                )
            
            # Create temporary directory for this scan
            temp_dir = tempfile.mkdtemp()
            
            # Save uploaded files
            saved_files = []
            for file in files:
                if file and file.filename:
                    # Validate file type
                    if not allowed_file(file.filename):
                        raise HTTPException(
                            status_code=400,
                            detail=f"File type not allowed: {file.filename}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
                        )
                    
                    # Read file content
                    content = await file.read()
                    
                    # Check file size
                    if len(content) > MAX_FILE_SIZE:
                        raise HTTPException(
                            status_code=400,
                            detail=f"File too large: {file.filename}. Max size: 100MB"
                        )
                    
                    # Save file
                    filepath = os.path.join(temp_dir, file.filename)
                    with open(filepath, 'wb') as f:
                        f.write(content)
                    saved_files.append(filepath)
            
            if not saved_files:
                if temp_dir:
                    await cleanup_temp_directory(temp_dir)
                raise HTTPException(
                    status_code=400,
                    detail="No valid files uploaded"
                )
            
            scan_path = temp_dir
            print(f"\n[SCAN MODE] Uploaded Files: {len(saved_files)}")
            
        else:
            # Neither files nor folder provided
            raise HTTPException(
                status_code=400,
                detail="Either files or folder_path must be provided"
            )
        
        # Run PII discovery
        print(f"[SCAN] Starting PII discovery...")
        print(f"[SCAN] Anchors: {list(anchors.keys())}")
        print(f"[SCAN] Path: {scan_path}")
        
        # Run discovery in thread pool to avoid blocking
        results = await asyncio.to_thread(discover_pii, scan_path, **anchors)
        
        # Format results for frontend
        formatted_results = format_results_for_frontend(results)
        
        # Schedule cleanup if temp directory was created
        if temp_dir:
            background_tasks.add_task(cleanup_temp_directory, temp_dir)
        
        print(f"[SCAN] Complete. Found PII in {formatted_results['files_found']} files")
        
        return {
            "success": True,
            "results": formatted_results,
            "full_results": results  # Include full results for JSON download
        }
        
    except HTTPException:
        # Re-raise HTTP exceptions
        if temp_dir:
            await cleanup_temp_directory(temp_dir)
        raise
        
    except Exception as e:
        # Clean up on error
        if temp_dir:
            await cleanup_temp_directory(temp_dir)
        
        print(f"[ERROR] {str(e)}")
        traceback.print_exc()
        
        raise HTTPException(
            status_code=500,
            detail=f"Processing error: {str(e)}"
        )

@app.post("/api/download-report")
async def download_report(data: dict):
    """
    Download full PII discovery report as JSON
    
    Expects:
    - JSON body with full results
    
    Returns:
    - JSON file download
    """
    try:
        if not data:
            raise HTTPException(
                status_code=400,
                detail="No data provided"
            )
        
        # Create temporary file
        temp_file = tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.json',
            delete=False
        )
        
        # Write JSON data
        json.dump(data, temp_file, indent=2, ensure_ascii=False)
        temp_file.close()
        
        # Return file
        return FileResponse(
            temp_file.name,
            media_type='application/json',
            filename=f'pii_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        )
        
    except Exception as e:
        print(f"[ERROR] Download failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

# ============================================================================
# STARTUP & SHUTDOWN EVENTS
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Run on application startup"""
    print("\n" + "="*80)
    print("PII DISCOVERY WEB APPLICATION - FASTAPI BACKEND")
    print("="*80)
    print(f"\nServer starting...")
    print(f"Upload directory: {UPLOAD_DIR}")
    print(f"Max file size: {MAX_FILE_SIZE / (1024*1024):.0f}MB")
    print(f"Allowed extensions: {', '.join(ALLOWED_EXTENSIONS)}")
    print("\nAPI Endpoints:")
    print("  GET  /api/health            - Health check")
    print("  POST /api/scan              - Scan files/folder for PII")
    print("  POST /api/download-report   - Download JSON report")
    print("\nDocumentation:")
    print("  Interactive: http://localhost:8000/api/docs")
    print("  ReDoc:       http://localhost:8000/api/redoc")
    print("\n" + "="*80 + "\n")

@app.on_event("shutdown")
async def shutdown_event():
    """Run on application shutdown"""
    print("\n[SHUTDOWN] Cleaning up...")
    await cleanup_temp_directory(UPLOAD_DIR)
    print("[SHUTDOWN] Complete")

# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.exception_handler(413)
async def request_entity_too_large(request, exc):
    """Handle file too large error"""
    return JSONResponse(
        status_code=413,
        content={
            "success": False,
            "error": "File size exceeds 100MB limit"
        }
    )

@app.exception_handler(404)
async def not_found(request, exc):
    """Handle 404 errors"""
    return JSONResponse(
        status_code=404,
        content={
            "success": False,
            "error": "Endpoint not found"
        }
    )

@app.exception_handler(500)
async def internal_error(request, exc):
    """Handle 500 errors"""
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "Internal server error"
        }
    )

# ============================================================================
# MAIN (for development)
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # Auto-reload on code changes (development only)
        log_level="info"
    )
