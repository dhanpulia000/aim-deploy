import os


def pytest_configure():
    # Disable scheduler during tests
    os.environ["SCHEDULER_ENABLED"] = "false"

