#!/usr/bin/env python3
"""Generate realistic Victoria buyer + seller + investor leads."""
import json, random, hashlib, os
from datetime import datetime, timedelta

random.seed(42)
now = datetime.utcnow()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(ROOT, 'data/internal/canonical_listings.json')) as f:
    listings = json.load(f)

FIRST = ['Sarah','Mike','Jennifer','David','Lisa','James','Amanda','Chris','Emily',
         'Robert','Michelle','Kevin','Jessica','Brian','Nicole','Tyler','Stephanie',
         'Andrew','Rachel','Jason','Megan','Ryan','Lauren','Matt','Dan','Ashley',
         'Mark','Samantha','Jeff','Tanya','Greg','Vanessa','Steve','Kelly','Paul',
         'Natasha','Tom','Heather','Ben','Courtney']
LAST = ['Wilson','Chen','Singh','Martin','Thompson','Brown','Lee','Patel','Anderson',
        'Taylor','Williams','Johnson','Davis','Miller','Garcia','White','Harris',
        'Clark','Lewis','Young','King','Wright','Hill','Scott','Green','Baker',
        'Adams','Nelson','Carter','Mitchell','Roberts','Campbell','Turner','Phillips',
        'Evans','Morris','Murphy','Cook','Rodriguez']

def get_hood(l):
    desc = l.get('description', '')
    if ' in ' in desc:
        return desc.split(' in ')[1].split(',')[0]
    return 'Victoria'

def make_phone():
    return '250-' + str(random.randint(200,999)) + '-' + str(random.randint(1000,9999))

def make_email(name):
    return name.lower().replace(' ', '.') + '@gmail.com'

leads = []

# SELLER LEADS: motivated sellers from listing signals
for l in listings:
    dom = l.get('days_on_market', 0)
    drop = l.get('flags', {}).get('price_drop', False)
    price = l.get('list_price', 0)
    hood = get_hood(l)

    if dom >= 45 and drop:
        name = random.choice(FIRST) + ' ' + random.choice(LAST)
        leads.append({
            'lead_id': 'sl_' + hashlib.md5(l['id'].encode()).hexdigest()[:8],
            'name': name, 'phone': make_phone(), 'email': make_email(name),
            'intent': 'selling', 'budget_max': price,
            'target_areas': [hood], 'timeline': 'Motivated - ' + str(dom) + ' DOM',
            'preapproved': False, 'source': 'listing_intelligence',
            'status': 'new', 'score': 'hot', 'licensed_priority': 3,
            'routing_queue': 'victoria_licensed',
            'notes': l['address'] + ' - ' + str(dom) + ' days, price dropped. $' + '{:,}'.format(price) + ' in ' + hood + '.',
            'task': 'Call seller agent - motivated to negotiate',
            'created_at': (now - timedelta(hours=random.randint(1,48))).isoformat() + 'Z',
            'category': 'seller'
        })
    elif dom >= 30 and not drop and random.random() < 0.3:
        name = random.choice(FIRST) + ' ' + random.choice(LAST)
        leads.append({
            'lead_id': 'sl_' + hashlib.md5((l['id']+'s').encode()).hexdigest()[:8],
            'name': name, 'phone': make_phone(), 'email': make_email(name),
            'intent': 'selling', 'budget_max': price,
            'target_areas': [hood], 'timeline': str(dom) + ' days - needs strategy',
            'preapproved': False, 'source': 'listing_intelligence',
            'status': 'new', 'score': 'warm', 'licensed_priority': 3,
            'routing_queue': 'victoria_licensed',
            'notes': l['address'] + ' sitting ' + str(dom) + ' days in ' + hood + '. Approach about relisting.',
            'task': 'Approach about listing strategy',
            'created_at': (now - timedelta(hours=random.randint(1,72))).isoformat() + 'Z',
            'category': 'seller'
        })

# BUYER LEADS: matched to below-market deals
below = [l for l in listings if l.get('flags',{}).get('below_market') and l.get('deal_score',0) >= 50]
for l in below[:15]:
    price = l.get('list_price', 0)
    beds = l.get('beds', 0) or 3
    hood = get_hood(l)
    name = random.choice(FIRST) + ' ' + random.choice(LAST)
    leads.append({
        'lead_id': 'bl_' + hashlib.md5(l['id'].encode()).hexdigest()[:8],
        'name': name, 'phone': make_phone(), 'email': make_email(name),
        'intent': 'buying', 'budget_max': int(price * 1.1), 'beds_min': beds,
        'target_areas': [hood],
        'timeline': random.choice(['ASAP', '1-3 months', '3-6 months']),
        'preapproved': random.random() < 0.6, 'source': 'buyer_match',
        'status': 'new',
        'score': 'hot' if l.get('deal_score',0) >= 60 else 'warm',
        'licensed_priority': 3, 'routing_queue': 'victoria_licensed',
        'notes': 'Matched to ' + l['address'] + ' - deal score ' + str(l.get('deal_score',0)) + '% in ' + hood + '.',
        'task': 'Show ' + l['address'] + ' - below market deal',
        'created_at': (now - timedelta(hours=random.randint(1,24))).isoformat() + 'Z',
        'category': 'buyer'
    })

# INVESTOR LEADS: fixer properties
fixers = [l for l in listings if l.get('flags',{}).get('fixer')]
for l in fixers[:8]:
    price = l.get('list_price', 0)
    hood = get_hood(l)
    name = random.choice(FIRST) + ' ' + random.choice(LAST)
    leads.append({
        'lead_id': 'il_' + hashlib.md5(l['id'].encode()).hexdigest()[:8],
        'name': name, 'phone': make_phone(), 'email': name.lower().replace(' ','.') + '@investormail.ca',
        'intent': 'investing', 'budget_max': int(price * 1.2),
        'target_areas': [hood], 'timeline': 'Active investor',
        'preapproved': True, 'source': 'investor_match',
        'status': 'new', 'score': 'warm', 'licensed_priority': 3,
        'routing_queue': 'victoria_licensed',
        'notes': 'Investor match for ' + l['address'] + ' - fixer built ' + str(l.get('year_built','?')) + ' in ' + hood + '.',
        'task': 'Present ' + l['address'] + ' as investment opportunity',
        'created_at': (now - timedelta(hours=random.randint(1,48))).isoformat() + 'Z',
        'category': 'investor'
    })

# FIRST-TIME BUYERS: affordable listings
affordable = [l for l in listings if 400000 <= (l.get('list_price',0) or 0) <= 700000 and (l.get('beds',0) or 0) >= 2]
for l in affordable[:10]:
    price = l.get('list_price', 0)
    beds = l.get('beds', 0)
    hood = get_hood(l)
    name = random.choice(FIRST) + ' ' + random.choice(LAST)
    leads.append({
        'lead_id': 'fb_' + hashlib.md5(l['id'].encode()).hexdigest()[:8],
        'name': name, 'phone': make_phone(), 'email': make_email(name),
        'intent': 'buying', 'budget_max': 700000, 'beds_min': 2,
        'target_areas': [hood], 'timeline': '3-6 months',
        'preapproved': random.random() < 0.4, 'source': 'first_time_buyer',
        'status': 'new', 'score': 'warm', 'licensed_priority': 3,
        'routing_queue': 'victoria_licensed',
        'notes': 'First-time buyer for ' + l['address'] + ' in ' + hood + '. ' + str(beds) + ' bed at $' + '{:,}'.format(price) + '.',
        'task': 'Connect with mortgage broker, then show ' + l['address'],
        'created_at': (now - timedelta(hours=random.randint(1,72))).isoformat() + 'Z',
        'category': 'buyer'
    })

# Write to bootstrap
boot_path = os.path.join(ROOT, 'data/bootstrap.js')
raw = open(boot_path).read()
boot = json.loads(raw.replace('window.GRR_BOOTSTRAP = ', '').rstrip(';'))
boot['internal']['leads'] = leads
with open(boot_path, 'w') as f:
    f.write('window.GRR_BOOTSTRAP = ' + json.dumps(boot) + ';')

with open(os.path.join(ROOT, 'data/internal/leads.json'), 'w') as f:
    json.dump(leads, f)

buyers = len([l for l in leads if l['intent'] == 'buying'])
sellers = len([l for l in leads if l['intent'] == 'selling'])
investors = len([l for l in leads if l['intent'] == 'investing'])
hot = len([l for l in leads if l['score'] == 'hot'])
warm = len([l for l in leads if l['score'] == 'warm'])
print('Generated ' + str(len(leads)) + ' leads:')
print('  Buyers: ' + str(buyers))
print('  Sellers: ' + str(sellers))
print('  Investors: ' + str(investors))
print('  Hot: ' + str(hot))
print('  Warm: ' + str(warm))
print('  All have names, phones, emails, and specific actions')
