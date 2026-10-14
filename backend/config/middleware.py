from django.http import HttpResponse


class HealthCheckMiddleware:
    """Answer load balancer health checks before host validation or DB access."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path == "/api/health/":
            return HttpResponse("ok", content_type="text/plain")
        return self.get_response(request)
