"""Sonde — Scientific discovery management for the Aeolus research platform."""

try:
    from ._version import __version__  # type: ignore[import-not-found]
except ImportError:
    from importlib.metadata import PackageNotFoundError, version

    try:
        __version__ = version("sonde")
    except PackageNotFoundError:
        __version__ = "0.0.0+unknown"
