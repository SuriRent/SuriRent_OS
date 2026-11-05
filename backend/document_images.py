from io import BytesIO


def pdf_first_page_jpeg(pdf_bytes: bytes) -> bytes:
    try:
        import pymupdf

        with pymupdf.open(stream=pdf_bytes, filetype="pdf") as document:
            if not document.page_count:
                raise ValueError("PDF bevat geen pagina's")
            pixmap = document[0].get_pixmap(matrix=pymupdf.Matrix(2.5, 2.5), alpha=False)
            return pixmap.tobytes("jpeg", jpg_quality=85)
    except Exception as primary_error:
        try:
            from pdf2image import convert_from_bytes

            pages = convert_from_bytes(
                pdf_bytes, first_page=1, last_page=1, dpi=180, fmt="jpeg",
            )
            if not pages:
                raise ValueError("PDF bevat geen pagina's")
            output = BytesIO()
            pages[0].save(output, format="JPEG", quality=85)
            return output.getvalue()
        except Exception as fallback_error:
            raise RuntimeError(
                f"PDF image conversion failed: {primary_error}; fallback failed: {fallback_error}"
            ) from fallback_error
