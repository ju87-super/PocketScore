"""Inspect real serialized MSCZ/MSCX notes and durations; no GUI success is inferred."""
import json
import sys
from fractions import Fraction
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile, is_zipfile

data = Path(sys.argv[1]).read_bytes()
if is_zipfile(BytesIO(data)):
    with ZipFile(BytesIO(data)) as archive:
        container = ET.fromstring(archive.read('META-INF/container.xml'))
        filename = container.find('.//rootfile').attrib['full-path']
        data = archive.read(filename)
root = ET.fromstring(data)
durations = {'whole': Fraction(1), 'half': Fraction(1, 2), 'quarter': Fraction(1, 4), 'eighth': Fraction(1, 8), '16th': Fraction(1, 16)}
voices = []
for voice in root.findall('./Score/Staff/Measure/voice'):
    events = []
    start = Fraction(0)
    for item in voice:
        if item.tag not in ('Chord', 'Rest'):
            continue
        duration = durations[item.findtext('durationType')]
        dots = int(item.findtext('dots', '0'))
        duration *= sum(Fraction(1, 2 ** i) for i in range(dots + 1))
        pitches = [int(note.findtext('pitch')) for note in item.findall('Note')]
        events.append({'start': str(start), 'duration': str(duration), 'pitches': pitches})
        start += duration
    voices.append(events)
if not voices:
    raise ValueError('Saved score has no musical voices')
print(json.dumps(voices))
