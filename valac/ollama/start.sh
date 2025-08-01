#!/bin/sh
ollama pull mistral || true
ollama pull nomic-embed-text || true
ollama serve