from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile

from backend.analysis_api.service import analyze_uploaded_file


app = FastAPI(title="analysis_api", version="1.0.0")


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    filename = (file.filename or "").strip()

    if not filename:
        raise HTTPException(status_code=400, detail="اسم الملف غير صالح.")

    try:
        payload = await file.read()
        return analyze_uploaded_file(filename, payload)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"تعذر تحليل الملف: {error}") from error
