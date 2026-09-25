# Project Architecture Rules

- PDF automation blocks store the original filename and a generated first-page image; send the image immediately before the PDF because Meta Cloud API has no document-thumbnail field.