import sys
try:
    from pypdf import PdfReader
except ImportError:
    from PyPDF2 import PdfReader

reader = PdfReader(r"D:\yupoo\style-mitgalgel\RollingStyle_QA_Report_2026-05-09.pdf")
for i, page in enumerate(reader.pages):
    print(f"\n{'='*60}\nPAGE {i+1}\n{'='*60}")
    print(page.extract_text())
