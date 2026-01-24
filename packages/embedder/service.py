from sentence_transformers import SentenceTransformer
from flask import Flask, request, jsonify
import json

# Initialize Flask app
app = Flask(__name__)

# Load the model once at startup and keep it in memory
model_name = "all-distilroberta-v1"
model = SentenceTransformer(model_name)

def generate_embedding(text):
    """Generate embedding for a given text."""
    # normalize_embeddings=True ensures output vectors have magnitude 1
    embedding = model.encode(text, convert_to_numpy=True, normalize_embeddings=True)
    return embedding.tolist()

@app.route('/embed', methods=['POST'])
def embed_text():
    """Endpoint to generate embeddings from text."""
    # Expect JSON input with a 'text' field
    data = request.get_json()
    if not data or 'text' not in data:
        print('bad request')
        return jsonify({'error': 'Missing "text" field in JSON request'}), 400
    
    input_text = data['text']
    print('embedding', input_text)
    try:
        embedding = generate_embedding(input_text)
        return jsonify({'embedding': embedding}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Run the server on port 3002
    app.run(host='127.0.0.1', port=3002, debug=False)
