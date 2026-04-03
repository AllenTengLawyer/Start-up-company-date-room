from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import os
import sqlite3

from .database import init_db
from .routers import projects, founders, categories, files, ldd, export, versions, templates

app = FastAPI(title="创业助手 · 公司文件整理系统")

@app.exception_handler(sqlite3.OperationalError)
def handle_sqlite_operational_error(_, exc: sqlite3.OperationalError):
    msg = str(exc)
    if "locked" in msg.lower():
        return JSONResponse(status_code=503, content={"detail": "数据库正忙（database is locked），请稍后重试"})
    return JSONResponse(status_code=500, content={"detail": msg})

@app.exception_handler(PermissionError)
def handle_permission_error(_, exc: PermissionError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})

@app.exception_handler(Exception)
def handle_unexpected_error(_, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": str(exc)})

@app.on_event("startup")
def startup():
    init_db()

app.include_router(projects.router, prefix="/api")
app.include_router(founders.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(files.router, prefix="/api")
app.include_router(ldd.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(versions.router, prefix="/api")
app.include_router(templates.router, prefix="/api")

@app.get("/api/health")
def health():
    return {"status": "ok"}

# Serve frontend — must be last
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
