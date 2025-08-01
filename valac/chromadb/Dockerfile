# ./chroma/Dockerfile

FROM python:3.10-slim

WORKDIR /app

# Install ChromaDB and all its required runtime dependencies
RUN pip install \
    numpy==1.26.4 \
    chromadb==0.4.24 \
    uvicorn==0.30.0 \
    fastapi==0.111.0 \
    opentelemetry-api \
    opentelemetry-sdk \
    opentelemetry-instrumentation \
    opentelemetry-instrumentation-fastapi

ENV CHROMA_SERVER_HOST=0.0.0.0
ENV CHROMA_SERVER_HTTP_PORT=8000

CMD ["uvicorn", "chromadb.app:app", "--host", "0.0.0.0", "--port", "8000"]

# RUN pip install --upgrade pip \
#     && pip install chromadb==0.4.24

# EXPOSE 8000

# CMD ["python", "-m", "chromadb"]