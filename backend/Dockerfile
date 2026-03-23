FROM python:3.10-slim-bookworm

WORKDIR /app

# Install Node.js (for AIS WebSocket proxy) and curl (for network fallback)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install --with-deps chromium

# Install Node.js dependencies (ws module for AIS WebSocket proxy)
# Copy manifests first so this layer is cached unless deps change
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Keep a pristine copy of data/ so the entrypoint can seed the volume
RUN cp -r /app/data /app/data_seed

# Copy and set entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create a non-root user for security
# Grant write access to /app so the auto-updater can extract files
RUN adduser --system --uid 1001 backenduser \
    && chown -R backenduser /app \
    && chmod -R u+w /app

# Switch to the non-root user
USER backenduser

# Expose port
EXPOSE 8000

# Entrypoint seeds static data files into the persistent volume
ENTRYPOINT ["/app/entrypoint.sh"]

# Start FastAPI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
