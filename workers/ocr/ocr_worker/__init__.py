from PIL import Image

__version__ = "0.1.0"

# Keep Pillow from decompressing images larger than the worker pixel budget
# before our own frame-dimension checks run.
Image.MAX_IMAGE_PIXELS = 6_000_000
