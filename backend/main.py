from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import os

from .database import init_db
from .routers import projects, founders, categories, files, ldd, export

app = FastAPI(title="创业助手 · 公司文件整理系统")

@app.on_event("startup")
def startup():
    init_db()

app.include_router(projects.router, prefix="/api")
app.include_router(founders.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(files.router, prefix="/api")
app.include_router(ldd.router, prefix="/api")
app.include_router(export.router, prefix="/api")

@app.get("/api/health")
def health():
    return {"status": "ok"}

# Serve frontend — must be last
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
