"""How alike two texts are, for finding duplicate dares and questions.

No outside service: both texts are reduced to the stems of their meaningful
words, and the score blends how many stems they share with how much of the
word sequence matches. Case, punctuation, word order and small edits do not
change the result ("Спой куплет любимой песни!" ~ "спой куплет любимой
песни"); a paraphrase in other words is not found.
"""

import re
from difflib import SequenceMatcher

# From this score on an idea is shown the similar ones and must be confirmed;
# from DUPLICATE on it cannot be sent at all.
SIMILAR = 0.6
DUPLICATE = 0.9

# Short words that carry no meaning of their own.
STOP = {
    "и", "в", "во", "на", "с", "со", "к", "ко", "по", "из", "за", "у", "о", "об", "от", "до", "для", "а", "но",
    "же", "ли", "бы", "то", "как", "что", "это", "все", "всем", "свой", "своё", "свою", "своей", "своих",
}

_WORD = re.compile(r"\w+", re.UNICODE)


def _stem(word):
    # "песни", "песню", "песня" -> "песн": a crude stem is enough here
    return word[:4] if len(word) >= 5 else word


def tokens(text):
    """The stems of the meaningful words, in order."""
    text = (text or "").lower().replace("ё", "е")
    text = text.replace("{p1}", " игрок ").replace("{p2}", " игрок ")
    return [_stem(w) for w in _WORD.findall(text) if w not in STOP]


def score_tokens(a, b):
    if not a or not b:
        return 0.0
    sa, sb = set(a), set(b)
    jaccard = len(sa & sb) / len(sa | sb)
    order = SequenceMatcher(None, " ".join(a), " ".join(b)).ratio()
    return max(jaccard, 0.5 * jaccard + 0.5 * order)


def score(a, b):
    return score_tokens(tokens(a), tokens(b))


def marked_parts(text, query_stems):
    """The text cut into pieces, each marked when it is a word the query also has."""
    parts = []
    for piece in re.split(r"(\w+)", text or ""):
        if not piece:
            continue
        is_word = bool(_WORD.fullmatch(piece))
        parts.append({"text": piece, "match": is_word and _stem(piece.lower().replace("ё", "е")) in query_stems})
    return parts


def find_similar(query, candidates, limit=3, minimum=SIMILAR):
    """candidates: iterable of dicts with at least "text". Returns the best
    matches (score >= minimum), most alike first, each with its "score"."""
    q = tokens(query)
    if not q:
        return []
    qset = set(q)
    found = []
    for cand in candidates:
        t = tokens(cand["text"])
        # cheap filter before the slower sequence comparison
        if not t or not (qset & set(t)):
            continue
        s = score_tokens(q, t)
        if s >= minimum:
            found.append({**cand, "score": s})
    found.sort(key=lambda c: c["score"], reverse=True)
    return found[:limit]
