FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
RUN useradd --create-home --uid 1000 app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN DJANGO_DEBUG=1 python manage.py collectstatic --noinput

USER app
EXPOSE 8000

# Only the ALB can reach the task, so trust its X-Forwarded-* headers.
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--timeout", "30", \
     "--forwarded-allow-ips", "*", \
     "--access-logfile", "-"]
