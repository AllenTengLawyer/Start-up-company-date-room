"""
Text extraction service for full-text search.
Supports PDF, DOCX, and plain text files.
"""
import os
import hashlib


def calculate_file_hash(file_path: str) -> str:
    """Calculate MD5 hash of file content."""
    hash_md5 = hashlib.md5()
    try:
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()
    except Exception:
        return None


def get_file_size(file_path: str) -> int:
    """Get file size in bytes."""
    try:
        return os.path.getsize(file_path)
    except Exception:
        return 0


def get_file_mtime(file_path: str) -> str:
    """Get file last modified time as ISO format string."""
    try:
        from datetime import datetime
        mtime = os.path.getmtime(file_path)
        return datetime.fromtimestamp(mtime).isoformat()
    except Exception:
        return None


def extract_pdf_text(file_path: str) -> str:
    """Extract text from PDF file using PyPDF2."""
    try:
        import PyPDF2
        text_parts = []
        with open(file_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        return "\n".join(text_parts)
    except Exception as e:
        return f""


def extract_docx_text(file_path: str) -> str:
    """Extract text from DOCX file using python-docx."""
    try:
        import docx
        doc = docx.Document(file_path)
        text_parts = []
        for para in doc.paragraphs:
            if para.text:
                text_parts.append(para.text)
        return "\n".join(text_parts)
    except Exception as e:
        return f""


def extract_txt_text(file_path: str) -> str:
    """Extract text from plain text file."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    except Exception:
        return ""


def extract_text(file_path: str) -> str:
    """
    Extract text from file based on extension.
    Returns empty string if extraction fails or file type not supported.
    """
    if not os.path.isfile(file_path):
        return ""

    ext = os.path.splitext(file_path)[1].lower()

    extractors = {
        '.pdf': extract_pdf_text,
        '.docx': extract_docx_text,
        '.txt': extract_txt_text,
        '.md': extract_txt_text,
        '.json': extract_txt_text,
        '.csv': extract_txt_text,
    }

    extractor = extractors.get(ext)
    if extractor:
        return extractor(file_path)

    return ""


def should_extract_text(file_path: str) -> bool:
    """Check if file type supports text extraction."""
    ext = os.path.splitext(file_path)[1].lower()
    return ext in ['.pdf', '.docx', '.txt', '.md', '.json', '.csv']
