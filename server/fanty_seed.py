ALL_LOCATIONS = ["street", "apartment", "bar", "country_house"]

SOLO_DARES = [
    {"text": "Выпей стакан воды без использования рук.", "categories": ["basic"], "locations": ALL_LOCATIONS},
    {"text": "Изобрази свою любимую песню без слов — только мимикой и жестами, остальные угадывают.", "categories": ["basic"], "locations": ALL_LOCATIONS},
    {"text": "Позвони случайному контакту из телефона и спой ему куплет любой песни.", "categories": ["basic"], "locations": ["apartment", "country_house"]},
    {"text": "Пройдись как супермодель по «подиуму» из комнаты и обратно.", "categories": ["basic"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "Расскажи анекдот, стоя на одной ноге.", "categories": ["basic"], "locations": ALL_LOCATIONS},
    {"text": "Изобрази пять разных животных подряд, пусть остальные угадывают каждое.", "categories": ["basic"], "locations": ALL_LOCATIONS},
    {"text": "Сделай комплимент каждому человеку в комнате по очереди.", "categories": ["basic"], "locations": ALL_LOCATIONS},
    {"text": "Спой один куплет своей любимой песни во весь голос.", "categories": ["basic"], "locations": ["apartment", "country_house", "bar"]},
    {"text": "Станцуй импровизированный танец 30 секунд под воображаемую музыку.", "categories": ["basic"], "locations": ALL_LOCATIONS},
    {"text": "Съешь дольку лимона без воды и не поморщившись.", "categories": ["basic", "food"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "Позволь другому игроку накрасить тебе одну бровь (или нарисовать усы) на выбор группы.", "categories": ["basic"], "locations": ["apartment", "country_house"]},
    {"text": "Прокричи «Я обожаю понедельники!» в окно (или на улицу).", "categories": ["basic"], "locations": ["street", "country_house"]},
    {"text": "Сделай 10 приседаний, озвучивая каждое подсчётом на другом языке.", "categories": ["basic"], "locations": ALL_LOCATIONS},
    {"text": "Съешь ложку острого соуса или специи без запивки.", "categories": ["food"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "Выпей залпом рюмку, которую тебе нальют остальные игроки.", "categories": ["alcohol"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "Смешай себе странный коктейль из того, что есть под рукой, и выпей его.", "categories": ["alcohol"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "Прими комплимент от каждого игрока, глядя ему в глаза, без «спасибо, ну что ты».", "categories": ["flirt"], "locations": ALL_LOCATIONS},
    {"text": "Сделай самое соблазнительное селфи, на какое способен, и покажи всем.", "categories": ["flirt"], "locations": ALL_LOCATIONS},
    {"text": "Выбери человека в комнате и признайся ему в одной вещи, которая тебе в нём нравится.", "categories": ["flirt"], "locations": ALL_LOCATIONS},
    {"text": "Присядь как можно ближе к человеку слева от тебя и не отодвигайся до конца следующего раунда.", "categories": ["flirt_plus"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "Прошепчи на ухо игроку справа от тебя самый смешной комплимент, какой придумаешь.", "categories": ["flirt_plus"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "Станцуй медленный танец с любым игроком по своему выбору 20 секунд.", "categories": ["flirt_plus"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "Съешь острое крылышко (или другую острую закуску) без единого глотка воды.", "categories": ["food"], "locations": ["bar", "country_house", "apartment"]},
    {"text": "Накорми с рук любого игрока по его выбору.", "categories": ["food", "flirt"], "locations": ["apartment", "bar", "country_house"]},
]

TEAM_DARES = [
    {"text": "{p1} держит {p2} за ноги, а {p2} должен отжаться от пола 5 раз и громко охать при каждом отжимании.", "categories": ["basic"], "locations": ["apartment", "country_house"]},
    {"text": "{p1} и {p2} вместе изображают сцену из фильма, который выберут остальные игроки.", "categories": ["basic"], "locations": ALL_LOCATIONS},
    {"text": "{p1} и {p2} должны станцевать танго на скорую руку под счёт остальных игроков.", "categories": ["basic"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "{p1} завязывает глаза, а {p2} с помощью только голоса должен провести его через комнату и обратно.", "categories": ["basic"], "locations": ["apartment", "country_house"]},
    {"text": "{p1} и {p2} по очереди говорят комплименты друг другу, пока кто-то не собьётся или не засмеётся.", "categories": ["basic"], "locations": ALL_LOCATIONS},
    {"text": "{p1} и {p2} выпивают по рюмке одновременно, чокнувшись локтями вместо рук.", "categories": ["alcohol"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "{p1} придумывает коктейль, а {p2} должен выпить его не спрашивая, что внутри.", "categories": ["alcohol"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "{p1} и {p2} должны покормить друг друга с рук любой закуской со стола.", "categories": ["food", "flirt"], "locations": ["apartment", "bar", "country_house"]},
    {"text": "{p1} и {p2} 20 секунд смотрят друг другу в глаза не отводя взгляд и не смеясь.", "categories": ["flirt"], "locations": ALL_LOCATIONS},
    {"text": "{p1} и {p2} должны обняться и продержать объятия, пока остальные считают до 15.", "categories": ["flirt_plus"], "locations": ["apartment", "bar", "country_house"]},
]

TRUTHS = [
    {"text": "Бил ли ты когда-нибудь животное?", "categories": ["basic"]},
    {"text": "Какая самая большая ложь, которую ты рассказывал родителям?", "categories": ["basic"]},
    {"text": "Что самое странное ты гуглил на прошлой неделе?", "categories": ["basic"]},
    {"text": "Какой твой самый неловкий момент на публике?", "categories": ["basic"]},
    {"text": "Ты когда-нибудь притворялся больным, чтобы не пойти на работу или учёбу?", "categories": ["basic"]},
    {"text": "Какая твоя самая абсурдная детская мечта?", "categories": ["basic"]},
    {"text": "Ты когда-нибудь читал переписку друга без разрешения?", "categories": ["basic"]},
    {"text": "Какой самый глупый штраф или проступок у тебя был?", "categories": ["basic"]},
    {"text": "Что ты сделал, за что тебе до сих пор стыдно?", "categories": ["basic"]},
    {"text": "Кому из присутствующих ты бы никогда не одолжил денег?", "categories": ["basic"]},
    {"text": "Какая твоя самая нелепая отговорка от опоздания?", "categories": ["basic"]},
    {"text": "Ты когда-нибудь присваивал себе чужую заслугу?", "categories": ["basic"]},
    {"text": "Сколько раз в среднем в день ты проверяешь телефон и не стыдно ли тебе?", "categories": ["basic"]},
    {"text": "Ты когда-нибудь симулировал интерес к разговору, думая о своём?", "categories": ["basic"]},
    {"text": "Какой твой самый постыдный музыкальный вкус, который ты скрываешь?", "categories": ["basic"]},
    {"text": "В кого из присутствующих ты был(а) тайно влюблён(а)?", "categories": ["flirt"]},
    {"text": "Как ты понимаешь, что нравишься человеку?", "categories": ["flirt"]},
    {"text": "Было ли у тебя свидание, которое ты сбежал(а) раньше времени?", "categories": ["flirt"]},
    {"text": "Кого из присутствующих ты бы выбрал(а) для поцелуя, если бы пришлось?", "categories": ["flirt_plus"]},
    {"text": "Какой был твой самый неловкий момент на первом свидании?", "categories": ["flirt"]},
    {"text": "Признавался(ась) ли ты кому-то в чувствах и получил(а) отказ?", "categories": ["flirt"]},
    {"text": "Какая твоя самая смелая романтическая история?", "categories": ["flirt_plus"]},
    {"text": "Ты когда-нибудь напивался(ась) так, что не помнишь часть вечера?", "categories": ["basic"]},
    {"text": "Какой самый странный поступок ты совершал(а) будучи выпившим(ей)?", "categories": ["basic"]},
    {"text": "Какая твоя любимая еда, о которой стыдно признаться?", "categories": ["basic"]},
]


def _get_or_create_dare(db, entry, kind):
    row = db.execute("SELECT id FROM fanty_dares WHERE text = ?", (entry["text"],)).fetchone()
    if row:
        return row["id"]
    cur = db.execute(
        "INSERT INTO fanty_dares (text, kind, status) VALUES (?, ?, 'active')", (entry["text"], kind)
    )
    dare_id = cur.lastrowid
    db.executemany(
        "INSERT OR IGNORE INTO fanty_dare_categories (dare_id, category) VALUES (?, ?)",
        [(dare_id, c) for c in entry["categories"]],
    )
    db.executemany(
        "INSERT OR IGNORE INTO fanty_dare_locations (dare_id, location) VALUES (?, ?)",
        [(dare_id, loc) for loc in entry["locations"]],
    )
    return dare_id


def _get_or_create_truth(db, entry):
    row = db.execute("SELECT id FROM fanty_truths WHERE text = ?", (entry["text"],)).fetchone()
    if row:
        return row["id"]
    cur = db.execute("INSERT INTO fanty_truths (text, status) VALUES (?, 'active')", (entry["text"],))
    truth_id = cur.lastrowid
    db.executemany(
        "INSERT OR IGNORE INTO fanty_truth_categories (truth_id, category) VALUES (?, ?)",
        [(truth_id, c) for c in entry["categories"]],
    )
    return truth_id


def seed_fanty_content(db):
    existing = db.execute("SELECT COUNT(*) AS c FROM fanty_dares").fetchone()["c"]
    if existing > 0:
        return
    for entry in SOLO_DARES:
        _get_or_create_dare(db, entry, "solo")
    for entry in TEAM_DARES:
        _get_or_create_dare(db, entry, "team")
    for entry in TRUTHS:
        _get_or_create_truth(db, entry)
    db.commit()
