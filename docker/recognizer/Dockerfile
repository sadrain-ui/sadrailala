FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir recognizer || pip install --no-cache-dir pillow numpy
COPY server.py /app/server.py
ENV RECOGNIZER_PORT=5000
EXPOSE 5000
CMD ["python", "/app/server.py"]
