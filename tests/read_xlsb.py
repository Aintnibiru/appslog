from pyxlsb import open_workbook
p = r"C:\Projects\appslog\MASTER INPUT APPS.xlsb"
with open_workbook(p) as wb:
    print("SHEETS:", wb.sheets)
    for name in wb.sheets:
        with wb.get_sheet(name) as sh:
            rows = []
            for i, row in enumerate(sh.rows()):
                vals = [c.v for c in row]
                while vals and vals[-1] is None:
                    vals.pop()
                if vals:
                    rows.append(vals)
                if i > 60:
                    break
            print("\n=== SHEET:", name, "sample rows:", len(rows))
            for r in rows[:18]:
                print(r)
