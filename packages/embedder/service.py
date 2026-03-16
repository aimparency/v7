import logging
import os
import shutil
from pathlib import Path

from fastembed import TextEmbedding
from flask import Flask, jsonify, request

MODEL_NAME = os.getenv("EMBEDDER_MODEL", "BAAI/bge-small-en-v1.5")
BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = Path(os.getenv("FASTEMBED_CACHE_PATH", BASE_DIR / ".cache" / "fastembed"))

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("embedder")

# Initialize Flask app
app = Flask(__name__)

model = None
def _clear_model_cache() -> None:
    if CACHE_DIR.exists():
        shutil.rmtree(CACHE_DIR)


def _load_model(force_refresh: bool = False):
    if force_refresh:
        _clear_model_cache()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    os.environ["FASTEMBED_CACHE_PATH"] = str(CACHE_DIR)
    logger.info("Loading embedding model %s from %s", MODEL_NAME, CACHE_DIR)

    try:
        loaded_model = TextEmbedding(model_name=MODEL_NAME, cache_dir=str(CACHE_DIR))
        return loaded_model
    except Exception:
        logger.exception("Failed to load embedding model")
        raise


def get_model():
    global model

    if model is not None:
        return model

    try:
        model = _load_model()
        return model
    except Exception as first_error:
        logger.warning("Retrying embedder model load with a clean cache")
        try:
            model = _load_model(force_refresh=True)
            return model
        except Exception:
            raise first_error


def generate_embedding(text):
    """Generate embedding for a given text."""
    current_model = get_model()
    # fastembed returns a generator, get first result
    embedding = next(current_model.embed([text]))
    return embedding.tolist()


@app.get("/health")
def health():
    try:
        get_model()
        return jsonify({"status": "ok", "model": MODEL_NAME}), 200
    except Exception as exc:
        return jsonify({
            "status": "error",
            "model": MODEL_NAME,
            "error": f"Embedder model unavailable: {exc}",
        }), 503


@app.route("/embed", methods=["POST"])
def embed_text():
    """Endpoint to generate embeddings from text."""
    data = request.get_json(silent=True)
    if not data or "text" not in data:
        return jsonify({"error": 'Missing "text" field in JSON request'}), 400

    input_text = data["text"]
    try:
        embedding = generate_embedding(input_text)
        return jsonify({"embedding": embedding}), 200
    except Exception as exc:
        logger.exception("Embedding request failed")
        return jsonify({
            "error": f"Failed to generate embedding with {MODEL_NAME}: {exc}",
        }), 503


if __name__ == "__main__":
    port = int(os.getenv("PORT_EMBEDDER", "3003"))
    app.run(host="127.0.0.1", port=port, debug=False)
