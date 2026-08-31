# Recovery Worker

This is the required microservice.

It consumes conversation events and evaluates recovery rules asynchronously. It owns recovery-case processing and must be safe under duplicate event delivery.
