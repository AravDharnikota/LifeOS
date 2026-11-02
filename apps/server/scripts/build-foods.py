#!/usr/bin/env python3
"""Build apps/server/src/data/foods.json from USDA FoodData Central bulk downloads.

Sources (public domain, CC0):
  - FNDDS 2021-2023 survey JSON: FoodData_Central_survey_food_json_2024-10-31.zip -> surveyDownload.json
  - SR Legacy (April 2018) CSV:   FoodData_Central_sr_legacy_food_csv_2018-04.zip -> directory of CSV files

Usage:
  python3 -I scripts/build-foods.py <surveyDownload.json> <sr_legacy_csv_dir> <out.json> [--fndds N] [--sr N]

The downloads are treated as untrusted data: run with -I and keep them outside the repo.
Output: a JSON array sorted by a popularity heuristic (most common foods first):
  {id, name, brand, per100: {calories, proteinG, carbsG, fatG, fiberG, sugarG, sodiumMg,
   saturatedFatG, cholesterolMg, potassiumMg}, servings: [{label, grams}]}
"""

import argparse
import collections
import csv
import json
import math
import os
import re
import sys

NUTRIENTS = {
    1008: "calories",
    1003: "proteinG",
    1005: "carbsG",
    1004: "fatG",
    1079: "fiberG",
    2000: "sugarG",
    1063: "sugarG",
    1093: "sodiumMg",
    1258: "saturatedFatG",
    1253: "cholesterolMg",
    1092: "potassiumMg",
}
NUTRIENT_ORDER = ["calories", "proteinG", "carbsG", "fatG", "fiberG", "sugarG", "sodiumMg", "saturatedFatG", "cholesterolMg", "potassiumMg"]
INTEGER_FIELDS = {"calories", "sodiumMg", "cholesterolMg", "potassiumMg"}

GENERIC_RE = re.compile(r"\bNS as to\b|\bNFS\b")

# WWEIA category weights for FNDDS. Higher = more commonly logged. Missing = 1.0. Zero = excluded.
FNDDS_CATEGORY_WEIGHT = {
    "Chicken, whole pieces": 3.0,
    "Chicken patties, nuggets and tenders": 2.0,
    "Turkey, duck, other poultry": 1.8,
    "Eggs and omelets": 3.0,
    "Rice": 3.0,
    "Pasta, noodles, cooked grains": 2.6,
    "Oatmeal": 3.0,
    "Grits and other cooked cereals": 1.5,
    "Yeast breads": 2.6,
    "Rolls and buns": 2.2,
    "Bagels and English muffins": 2.4,
    "Tortillas": 2.6,
    "Biscuits, muffins, quick breads": 2.0,
    "Pancakes, waffles, French toast": 2.2,
    "Ready-to-eat cereal, higher sugar (>21.2g/100g)": 2.2,
    "Ready-to-eat cereal, lower sugar (=<21.2g/100g)": 2.4,
    "Fish": 2.6,
    "Shellfish": 2.2,
    "Beef, excludes ground": 2.8,
    "Ground beef": 3.0,
    "Pork": 2.6,
    "Bacon": 2.8,
    "Sausages": 2.2,
    "Frankfurters": 2.0,
    "Cold cuts and cured meats": 2.4,
    "Lamb, goat, game": 1.4,
    "Liver and organ meats": 0.8,
    "Meat mixed dishes": 1.6,
    "Poultry mixed dishes": 1.6,
    "Seafood mixed dishes": 1.2,
    "Pasta mixed dishes, excludes macaroni and cheese": 1.6,
    "Macaroni and cheese": 2.0,
    "Rice mixed dishes": 1.6,
    "Bean, pea, legume dishes": 1.6,
    "Beans, peas, legumes": 2.6,
    "Vegetable dishes": 1.4,
    "Stir-fry and soy-based sauce mixtures": 1.4,
    "Other Mexican mixed dishes": 1.4,
    "Burritos and tacos": 2.2,
    "Nachos": 1.6,
    "Pizza": 2.4,
    "Burgers": 2.4,
    "Chicken fillet sandwiches": 1.8,
    "Egg/breakfast sandwiches": 1.8,
    "Deli and cured meat sandwiches": 1.8,
    "Meat and BBQ sandwiches": 1.4,
    "Seafood sandwiches": 1.0,
    "Cheese sandwiches": 1.6,
    "Peanut butter and jelly sandwiches": 1.8,
    "Vegetable sandwiches/burgers": 1.6,
    "Frankfurter sandwiches": 1.4,
    "Egg rolls, dumplings, sushi": 1.8,
    "Fried rice and lo/chow mein": 1.8,
    "Ramen and Asian broth-based soups": 1.6,
    "Soups, broth-based": 1.6,
    "Soups, cream-based": 1.4,
    "White potatoes, baked or boiled": 2.4,
    "French fries and other fried white potatoes": 2.2,
    "Mashed potatoes and white potato mixtures": 2.0,
    "Other starchy vegetables": 1.8,
    "Other vegetables and combinations": 2.4,
    "Other dark green vegetables": 2.0,
    "Other red and orange vegetables": 2.0,
    "Broccoli": 2.8,
    "Spinach": 2.6,
    "Carrots": 2.6,
    "Corn": 2.4,
    "String beans": 2.2,
    "Cabbage": 2.0,
    "Onions": 2.6,
    "Tomatoes": 2.8,
    "Lettuce and lettuce salads": 2.6,
    "Coleslaw, non-lettuce salads": 1.6,
    "Olives, pickles, pickled vegetables": 1.8,
    "Fried vegetables": 1.2,
    "Vegetables on a sandwich": 0.6,
    "Apples": 3.0,
    "Bananas": 3.0,
    "Grapes": 3.0,
    "Peaches and nectarines": 2.6,
    "Pears": 2.6,
    "Pineapple": 2.6,
    "Mango and papaya": 2.6,
    "Melons": 2.6,
    "Strawberries": 3.0,
    "Blueberries and other berries": 3.0,
    "Citrus fruits": 2.8,
    "Other fruits and fruit salads": 2.4,
    "Dried fruits": 2.0,
    "Nuts and seeds": 2.6,
    "Cheese": 2.8,
    "Cottage/ricotta cheese": 2.4,
    "Cream cheese, sour cream, whipped cream": 2.2,
    "Cream and cream substitutes": 2.0,
    "Yogurt, Greek": 3.0,
    "Yogurt, regular": 2.6,
    "Plant-based yogurt": 1.8,
    "Milk, whole": 2.8,
    "Milk, reduced fat": 2.8,
    "Milk, lowfat": 2.8,
    "Milk, nonfat": 2.8,
    "Plant-based milk": 2.6,
    "Flavored milk, whole": 1.4,
    "Flavored milk, reduced fat": 1.4,
    "Flavored milk, lowfat": 1.2,
    "Flavored milk, nonfat": 1.0,
    "Milk shakes and other dairy drinks": 1.6,
    "Butter and animal fats": 2.6,
    "Margarine": 1.8,
    "Salad dressings and vegetable oils": 2.6,
    "Mayonnaise": 2.4,
    "Mustard and other condiments": 2.0,
    "Tomato-based condiments": 2.4,
    "Soy-based condiments": 2.2,
    "Dips, gravies, other sauces": 1.8,
    "Pasta sauces, tomato-based": 2.2,
    "Jams, syrups, toppings": 2.0,
    "Sugars and honey": 2.6,
    "Sugar substitutes": 1.4,
    "Peanut butter": 3.0,
    "Protein and nutritional powders": 2.6,
    "Nutrition bars": 2.2,
    "Cereal bars": 2.0,
    "Nutritional beverages": 1.8,
    "Smoothies and grain drinks": 2.0,
    "Sport and energy drinks": 2.0,
    "Diet sport and energy drinks": 1.4,
    "Soft drinks": 2.4,
    "Diet soft drinks": 2.0,
    "Fruit drinks": 1.6,
    "Citrus juice": 2.4,
    "Apple juice": 2.4,
    "Other fruit juice": 2.0,
    "Vegetable juice": 1.6,
    "Coffee": 2.2,
    "Tea": 2.2,
    "Beer": 2.0,
    "Wine": 2.0,
    "Liquor and cocktails": 1.4,
    "Tap water": 1.0,
    "Bottled water": 1.0,
    "Flavored or carbonated water": 1.4,
    "Enhanced water": 0.8,
    "Other diet drinks": 0.8,
    "Potato chips": 2.4,
    "Tortilla, corn, other chips": 2.2,
    "Popcorn": 2.2,
    "Pretzels/snack mix": 2.0,
    "Crackers, excludes saltines": 1.8,
    "Saltine crackers": 2.0,
    "Cookies and brownies": 2.0,
    "Cakes and pies": 1.8,
    "Doughnuts, sweet rolls, pastries": 1.8,
    "Turnovers and other grain-based items": 1.0,
    "Ice cream and frozen dairy desserts": 2.2,
    "Gelatins, ices, sorbets": 1.2,
    "Pudding": 1.4,
    "Candy containing chocolate": 2.2,
    "Candy not containing chocolate": 1.6,
    "Soy and meat-alternative products": 2.0,
    # excluded
    "Baby food: cereals": 0.0,
    "Baby food: fruit": 0.0,
    "Baby food: vegetables": 0.0,
    "Baby food: mixtures": 0.0,
    "Baby food: meat and dinners": 0.0,
    "Baby food: snacks and sweets": 0.0,
    "Baby food: yogurt": 0.0,
    "Baby juice": 0.0,
    "Baby water": 0.0,
    "Formula, prepared from powder": 0.0,
    "Formula, ready-to-feed": 0.0,
    "Not included in a food category": 0.0,
}

# SR Legacy categories to pull raw ingredients from, with weights.
SR_CATEGORY_WEIGHT = {
    "Fruits and Fruit Juices": 2.4,
    "Vegetables and Vegetable Products": 2.2,
    "Legumes and Legume Products": 2.0,
    "Nut and Seed Products": 2.2,
    "Dairy and Egg Products": 2.2,
    "Poultry Products": 2.0,
    "Beef Products": 1.8,
    "Pork Products": 1.6,
    "Finfish and Shellfish Products": 1.8,
    "Cereal Grains and Pasta": 2.0,
    "Fats and Oils": 1.8,
    "Spices and Herbs": 1.6,
}

# Head terms that make a food "everyday". Matched against the start of the cleaned name.
COMMON_HEADS = [
    "egg", "chicken breast", "chicken thigh", "chicken wing", "chicken drumstick", "chicken, ground", "ground beef", "beef steak", "beef, steak",
    "salmon", "tuna", "shrimp", "cod", "tilapia", "white rice", "brown rice", "rice", "oatmeal", "pasta", "noodles", "quinoa",
    "white bread", "whole wheat bread", "bread", "bagel", "tortilla", "potato", "sweet potato", "french fries",
    "banana", "apple", "orange", "strawberries", "blueberries", "grapes", "avocado", "mango", "watermelon", "pineapple",
    "broccoli", "spinach", "carrots", "tomato", "lettuce", "onion", "cucumber", "bell pepper", "mushrooms", "corn", "peas", "green beans",
    "milk", "whole milk", "greek yogurt", "yogurt", "cheddar cheese", "mozzarella cheese", "cheese", "cottage cheese", "butter", "cream cheese",
    "peanut butter", "almonds", "walnuts", "cashews", "peanuts", "olive oil", "honey", "sugar",
    "coffee", "tea", "orange juice", "beer", "wine", "protein powder", "protein shake", "protein bar",
    "pizza", "cheeseburger", "hamburger", "burrito", "taco", "sandwich", "sushi", "fried rice", "chili", "soup", "salad",
    "bacon", "sausage", "ham", "turkey", "pork chop", "pork tenderloin", "steak", "lamb",
    "black beans", "chickpeas", "lentils", "beans", "tofu", "edamame", "hummus",
    "ice cream", "chocolate", "cookie", "chips", "popcorn", "crackers", "granola", "cereal",
]

PART_WORDS = {"breast", "thigh", "wing", "drumstick", "leg", "steak", "chop", "loin", "tenderloin", "roast", "ribs", "shoulder", "belly", "brisket", "ground", "liver", "fillet", "patty", "cutlet", "nuggets", "tenders"}
ADJ_FIRST_HEADS = {"bread", "rice", "milk", "yogurt", "pasta", "noodles", "tortilla", "cheese", "flour", "sugar", "beans", "potato", "tea", "cereal", "crackers", "chips", "juice", "wine", "beer", "oil", "vinegar", "mustard", "salsa", "water"}
ADJ_FIRST_WORDS = {"white", "brown", "wild", "whole", "whole wheat", "whole grain", "multigrain", "rye", "sourdough", "greek", "plain", "skim", "nonfat", "lowfat", "low fat", "reduced fat", "2%", "1%", "corn", "flour", "black", "pinto", "kidney", "navy", "lima", "green", "red", "sweet", "baked", "dark", "light", "instant", "chocolate", "vanilla", "strawberry", "fruit", "soy", "almond", "oat", "coconut", "lactose free", "iced", "herbal", "sparkling", "dry", "sweetened", "unsweetened", "canola", "olive", "vegetable", "cider", "balsamic", "yellow", "dijon", "cheddar", "swiss", "american", "mozzarella", "feta", "goat", "parmesan", "cream", "cottage", "ricotta", "blue"}

DROP_SEGMENT_RES = [
    re.compile(r"^NS as to\b", re.I),
    re.compile(r"^NFS$", re.I),
    re.compile(r"^no added fat$", re.I),
    re.compile(r"^from (fast food|restaurant|school)", re.I),
    re.compile(r"^(fast food|restaurant|school lunch|school cafeteria)$", re.I),
    re.compile(r"^made from home recipe or purchased at a bakery$", re.I),
    re.compile(r"^ready-to-heat$", re.I),
    re.compile(r"^from fresh$", re.I),
    re.compile(r"^fresh$", re.I),
    re.compile(r"^NS as to form$", re.I),
    re.compile(r"^Puerto Rican style$", re.I),
    re.compile(r"^includes? .*$", re.I),
    re.compile(r"^(regular|regular or quick)$", re.I),
    re.compile(r"^Guideline amount.*$", re.I),
    re.compile(r"^not further specified$", re.I),
]
RENAME_SEGMENTS = {
    "fat added": "with added fat",
    "fat added, ns as to fat type": "with added fat",
    "baked or broiled": "baked or broiled",
    "boiled or poached": "boiled or poached",
    "lean and fat eaten": "lean and fat",
    "lean only eaten": "lean only",
    "skin eaten": "with skin",
    "skin not eaten": "without skin",
    "peel eaten": "with peel",
    "peel not eaten": "without peel",
    "grilled without sauce": "grilled",
    "made with water": "made with water",
}
PREP_ADJUST = [
    (re.compile(r"\b(grilled|baked or broiled|roasted|boiled or poached|scrambled|plain)\b", re.I), 0.3),
    (re.compile(r"\bcooked\b", re.I), 0.15),
    (re.compile(r"\bwithout skin\b", re.I), 0.1),
    (re.compile(r"\b(stewed|sauteed|steamed|poached)\b", re.I), -0.15),
    (re.compile(r"\b(candied|pickled|creamed|deviled|glazed|brined|jellied|stuffed)\b", re.I), -0.4),
    (re.compile(r"\b(canned|frozen|dried|dehydrated|unprepared|drained solids|solids and liquids)\b", re.I), -0.3),
    (re.compile(r"\b(with|and) (egg|onion|gravy|vegetables|gelatin|franks|tomatoes|dressing)\b", re.I), -0.3),
]
PENALTY_RES = [
    (re.compile(r"\bwith added fat\b", re.I), 0.6),
    (re.compile(r"\b(Puerto Rican|Hawaiian|native|Cuban|Alaska Native)\b", re.I), 0.6),
    (re.compile(r"\(([A-Z][A-Za-z' ]+)\)$"), 0.2),  # chain-branded items
    (re.compile(r"\bmade with (margarine|animal fat|cooking spray|non-dairy milk)\b", re.I), 0.8),
    (re.compile(r"\b(margarine|lard|drippings|cooking spray)\b", re.I), 0.5),
    (re.compile(r"\bbaby\b", re.I), 2.0),
    (re.compile(r"\b(decaffeinated|low sodium|reduced sodium|sugar free|fat free|nonfat or fat free)\b", re.I), 0.3),
    (re.compile(r"\b(reconstituted|dry mix|powder|concentrate|dehydrated|imitation)\b", re.I), 0.4),
    (re.compile(r"\bwith (gravy|cream or white sauce|tomato-based sauce|cheese sauce|mushroom sauce)\b", re.I), 0.2),
]
SR_EXCLUDE_RE = re.compile(r"\b(USDA Commodity|Commodity|Food Distribution Program|emu|ostrich|bison|elk|goose|guinea|squab|dove|turtle|frog|caribou|moose|bear|beaver|raccoon|opossum|muskrat|armadillo|whale|seal|walrus|veal|game|wild|industrial|infant|babyfood|mix,|dry mix|imitation|quality control|separable fat|raw, 1-inch|cured|acorns?|pepeao|breadfruit|mammy-apple|jujube|rowal|horned melon|natal plum|carissa|abiyuch|rose-apple|sapote|longans|feijoa|loquats|quinces|groundcherries|pummelo|durian|oheloberries|prickly pears|tamarinds|cornsalad|arrowhead|balsam-pear|borage|cardoon|chrysanthemum|dandelion|epazote|fiddlehead|jute|lambsquarters|nopales|poke|pokeberry|purslane|salsify|sesbania|taro|wasabi|winged|yardlong|surimi|mechanically|gizzard|heart|kidneys|tongue|brain|lungs|spleen|thymus|pancreas|tripe|feet|tail|neck|back|wing tip|skin only|fat only|shellie|pimento|straw|hearts of palm|baobab|tofu yogurt|okara|papad|meat extender|vegetarian|home recipe|home-prepared|candied|spanish style|with onions|regular pack|low calorie|light|reduced fat|fat free|mayonnaise-type)\b", re.I)
BRANDED_RE = re.compile(r"\b[A-Z][A-Z'&]{2,}\b")  # ALL-CAPS brand tokens


def tidy_text(s):
    s = re.sub(r"\s+", " ", s).strip(" ,")
    s = s.replace(" ,", ",")
    return s


def capitalize_first(s):
    return s[:1].upper() + s[1:] if s else s


def clean_name(desc):
    """Turn a USDA description into a readable label, e.g. 'Chicken, breast, grilled without sauce, skin not eaten' -> 'Chicken breast, grilled, without skin'."""
    raw = [tidy_text(p) for p in desc.split(",")]
    segs = []
    for seg in raw:
        if not seg:
            continue
        if any(r.search(seg) for r in DROP_SEGMENT_RES):
            continue
        seg = re.sub(r"\s+no added fat$", "", seg, flags=re.I)
        seg = RENAME_SEGMENTS.get(seg.lower(), seg)
        if seg.lower() == "ns as to fat type":
            continue
        segs.append(seg)
    if not segs:
        return None
    if segs[0].lower() in {"egg", "eggs"} and len(segs) >= 2 and segs[1].lower() == "whole":
        segs = [segs[0]] + segs[2:]
    head = segs[0]
    low_head = head.lower()
    if len(segs) >= 2:
        second = segs[1]
        low_second = second.lower()
        if low_head == "cheese" and low_second.endswith("cheese"):
            segs = [capitalize_first(second)] + segs[2:]
        elif low_head in {"chicken", "turkey", "beef", "pork", "lamb", "veal", "duck"} and low_second in PART_WORDS:
            if low_second == "ground":
                segs = [f"Ground {low_head}"] + segs[2:]
            else:
                segs = [f"{head} {low_second}"] + segs[2:]
        elif low_head == "fish" and re.fullmatch(r"[a-z][a-z ]+", second) and low_second not in {"raw", "canned", "smoked", "stick", "sticks", "cooked", "fried", "steamed", "baked or broiled", "grilled", "dried", "salad", "cake", "cakes"}:
            segs = [capitalize_first(second)] + segs[2:]
        elif low_head in {"nuts", "seeds", "spices"}:
            segs = [capitalize_first(second)] + segs[2:]
        elif low_head in {"oil"}:
            segs = [f"{capitalize_first(low_second)} oil"] + segs[2:]
        elif low_head in ADJ_FIRST_HEADS and low_second in ADJ_FIRST_WORDS:
            segs = [f"{capitalize_first(low_second)} {low_head}"] + segs[2:]
        elif low_head == "cheese" and re.fullmatch(r"[A-Za-z][A-Za-z ]+", second) and len(second.split()) <= 3 and low_second not in {"processed", "spread", "sauce"}:
            segs = [f"{second} cheese"] + segs[2:]
    name = ", ".join(segs)
    name = tidy_text(name)
    name = re.sub(r"\s*\(includes.*?\)", "", name, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip(" ,")
    return capitalize_first(name) if name else None


def popularity(name, category_weight, source):
    score = category_weight
    qualifiers = name.count(",")
    score -= (0.5 if source == "sr" else 0.35) * qualifiers
    score -= 0.01 * len(name)
    for rx, pen in PENALTY_RES:
        if rx.search(name):
            score -= pen
    for rx, adj in PREP_ADJUST:
        if rx.search(name):
            score += adj
    low = name.lower()
    for head in COMMON_HEADS:
        if low in (head, head + "s") or low.startswith(head + ",") or low.startswith(head + "s,"):
            score += 1.0
            break
    if source == "sr":
        score -= 0.4
        if re.search(r"\braw\b", low):
            score += 0.3
    return round(score, 3)


PORTION_PREFERENCE = [
    (re.compile(r"^1 (cup|tbsp|tsp|fl oz|oz|slice|egg|piece|medium|small|large|serving|banana|apple|orange|fruit|wing|breast|thigh|drumstick|patty|sandwich|taco|burrito|cookie|bar|can|bottle|packet|container|scoop)\b", re.I), 0),
    (re.compile(r"^(1|2|3|4|8|12) ", re.I), 1),
    (re.compile(r"\b(school|cubic inch|surface inch|yields|NFS|no ice)\b", re.I), 5),
]


def portion_rank(label):
    rank = 3
    for rx, r in PORTION_PREFERENCE:
        if rx.search(label):
            rank = min(rank, r) if r < 5 else rank + r
    return rank


def round_nutrients(nut):
    out = {}
    for k in NUTRIENT_ORDER:
        v = nut.get(k)
        if v is None:
            out[k] = None
        elif k in INTEGER_FIELDS:
            out[k] = int(round(v))
        else:
            out[k] = round(v, 1)
    return out


def clean_portion_label(label):
    label = tidy_text(label)
    label = re.sub(r"\s*\(.*?\)\s*$", "", label) if len(label) > 40 else label
    label = label.replace("tablespoon", "tbsp").replace("teaspoon", "tsp")
    return label


def pick_portions(ports, limit=4):
    seen = set()
    candidates = []
    for i, p in enumerate(ports):
        label = clean_portion_label(p["label"] or "")
        g = p["grams"]
        if not label or not isinstance(g, (int, float)) or g <= 0 or g > 5000:
            continue
        if re.match(r"^(Quantity not specified|Guideline amount)", label, re.I):
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        candidates.append((portion_rank(label), i, {"label": label, "grams": round(g, 1)}))
    candidates.sort(key=lambda c: (c[0], c[1]))
    return [c[2] for c in candidates[:limit]]


def load_fndds(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    foods = []
    for f in data["SurveyFoods"]:
        desc = f.get("description", "")
        if GENERIC_RE.search(desc):
            continue
        category = f.get("wweiaFoodCategory", {}).get("wweiaFoodCategoryDescription", "")
        weight = FNDDS_CATEGORY_WEIGHT.get(category, 1.0)
        if weight <= 0:
            continue
        nut = {}
        for n in f.get("foodNutrients", []):
            key = NUTRIENTS.get(n.get("nutrient", {}).get("id"))
            if key and key not in nut and isinstance(n.get("amount"), (int, float)):
                nut[key] = float(n["amount"])
        if "calories" not in nut:
            continue
        name = clean_name(desc)
        if not name:
            continue
        ports = [{"label": p.get("portionDescription") or "", "grams": p.get("gramWeight")} for p in f.get("foodPortions", [])]
        foods.append({
            "id": f"fndds-{f['foodCode']}",
            "name": name,
            "category": category,
            "per100": round_nutrients(nut),
            "servings": pick_portions(ports),
            "score": popularity(name, weight, "fndds"),
            "source": "fndds",
        })
    return foods


def read_csv(sr_dir, name):
    with open(os.path.join(sr_dir, name), newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def load_sr(sr_dir):
    cats = {r["id"]: r["description"] for r in read_csv(sr_dir, "food_category.csv")}
    units = {r["id"]: r["name"] for r in read_csv(sr_dir, "measure_unit.csv")}
    nut = collections.defaultdict(dict)
    for r in read_csv(sr_dir, "food_nutrient.csv"):
        key = NUTRIENTS.get(int(r["nutrient_id"]))
        if key and key not in nut[r["fdc_id"]]:
            try:
                nut[r["fdc_id"]][key] = float(r["amount"])
            except ValueError:
                continue
    ports = collections.defaultdict(list)
    for r in read_csv(sr_dir, "food_portion.csv"):
        unit = units.get(r["measure_unit_id"], "")
        unit = "" if unit == "undetermined" else unit
        amount = r["amount"]
        if amount.endswith(".0"):
            amount = amount[:-2]
        label = " ".join(x for x in (amount, unit, r["modifier"]) if x).strip() or r["portion_description"]
        try:
            ports[r["fdc_id"]].append({"label": label, "grams": float(r["gram_weight"])})
        except ValueError:
            continue
    foods = []
    for r in read_csv(sr_dir, "food.csv"):
        category = cats.get(r["food_category_id"], "")
        weight = SR_CATEGORY_WEIGHT.get(category)
        if not weight:
            continue
        desc = r["description"]
        if SR_EXCLUDE_RE.search(desc) or BRANDED_RE.search(desc):
            continue
        n = nut.get(r["fdc_id"])
        if not n or "calories" not in n:
            continue
        name = clean_name(desc)
        if not name:
            continue
        foods.append({
            "id": f"sr-{r['fdc_id']}",
            "name": name,
            "category": category,
            "per100": round_nutrients(n),
            "servings": pick_portions(ports.get(r["fdc_id"], [])),
            "score": popularity(name, weight, "sr"),
            "source": "sr",
        })
    return foods


def select(foods, limit, cap_fraction, cap_min):
    """Take the top `limit` foods by score with a per-category cap so no category dominates."""
    by_cat = collections.Counter(f["category"] for f in foods)
    caps = {c: max(cap_min, math.ceil(n * cap_fraction)) for c, n in by_cat.items()}
    taken = collections.Counter()
    out = []
    for f in sorted(foods, key=lambda x: -x["score"]):
        if taken[f["category"]] >= caps[f["category"]]:
            continue
        taken[f["category"]] += 1
        out.append(f)
        if len(out) >= limit:
            break
    return out


def dedupe(foods):
    seen = {}
    for f in sorted(foods, key=lambda x: -x["score"]):
        key = f["name"].lower()
        if key not in seen:
            seen[key] = f
    return list(seen.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fndds_json")
    ap.add_argument("sr_dir")
    ap.add_argument("out")
    ap.add_argument("--fndds", type=int, default=2000)
    ap.add_argument("--sr", type=int, default=500)
    args = ap.parse_args()

    fndds = dedupe(load_fndds(args.fndds_json))
    sr = dedupe(load_sr(args.sr_dir))
    sr_names = {f["name"].lower() for f in fndds}
    sr = [f for f in sr if f["name"].lower() not in sr_names]
    chosen = select(fndds, args.fndds, 0.55, 6) + select(sr, args.sr, 0.35, 8)
    chosen.sort(key=lambda x: (-x["score"], x["name"]))
    out = [{"id": f["id"], "name": f["name"], "brand": None, "per100": f["per100"], "servings": f["servings"]} for f in chosen]
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    size = os.path.getsize(args.out)
    print(f"{len(out)} foods ({sum(1 for f in chosen if f['source'] == 'fndds')} FNDDS, {sum(1 for f in chosen if f['source'] == 'sr')} SR Legacy) -> {args.out} ({size / 1e6:.2f} MB)")
    if size > 1_500_000:
        print("warning: output exceeds 1.5 MB", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
