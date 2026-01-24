from sentence_transformers import SentenceTransformer
import sys
import json

model = SentenceTransformer('all-MiniLM-L6-v2')
model.half()

def generate_embedding(text):
    embedding = model.encode(text, convert_to_numpy=True)
    return embedding.tolist()

if __name__ == "__main__":
    input_text = sys.argv[1]
    embedding = generate_embedding(input_text)
    
    print(json.dumps(embedding))
