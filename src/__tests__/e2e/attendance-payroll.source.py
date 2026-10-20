"""Independent original-workbook oracle. Reads ZIP/XML using Python's standard library.

Run with --write to regenerate the checked-in raw source fixture. Salary golden
values remain in attendance-payroll.fixtures.ts and are never rewritten here.
"""
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP
from zipfile import ZipFile

source = Path("docs/Total Punches(20261001-20261014).csv")
assert hashlib.sha256(source.read_bytes()).hexdigest() == "5c96e6912b261a4def094be00b46de516930b6fe085c1cdb75b71684d8779591"
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with ZipFile(source) as workbook:
    strings = ["".join(node.itertext()) for node in ET.fromstring(workbook.read("xl/sharedStrings.xml")).findall("s:si", ns)]
    sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))

rows = []
for row in sheet.findall("s:sheetData/s:row", ns):
    index = int(row.attrib["r"])
    if index < 3:
        continue
    cells = {}
    for cell in row.findall("s:c", ns):
        raw = cell.findtext("s:v", namespaces=ns)
        cells[cell.attrib["r"][0]] = strings[int(raw)] if cell.attrib.get("t") == "s" else raw
    date = (dt.date(1899, 12, 30) + dt.timedelta(days=int(cells["D"]))).isoformat()
    value = cells["G"]
    if ":" in value:
        times = [time.strip() for time in value.split(",")]
    else:
        seconds = int((Decimal(value) * 86400).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        times = [f"{seconds // 3600:02}:{seconds % 3600 // 60:02}"]
    minutes = [int(time[:2]) * 60 + int(time[3:5]) for time in times]
    completed = sum(minutes[i + 1] - minutes[i] for i in range(0, len(minutes) - 1, 2))
    assert completed >= 0, "Original report contains an unexpected overnight interval"
    hours = (Decimal(completed) / 60).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
    rows.append({"row": index, "code": cells["A"], "name": cells["B"], "date": date, "times": times, "completedHours": str(hours), "needsReview": len(times) % 2 == 1})

assert len(rows) == 52
assert sum(len(row["times"]) for row in rows) == 138
assert sum(row["needsReview"] for row in rows) == 12
fixture = {"sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "rows": rows}
target = Path("src/__tests__/fixtures/attendance-payroll-original.json")
if "--write" in sys.argv:
    target.write_text(json.dumps(fixture, indent=2) + "\n")
else:
    assert json.loads(target.read_text()) == fixture
print(json.dumps({"rows": len(rows), "punches": 138, "reviewRows": 12, "fixture": str(target)}))
