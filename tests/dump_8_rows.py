from pyxlsb import open_workbook
p = r"C:\Projects\appslog\MASTER INPUT APPS.xlsb"
with open_workbook(p) as wb:
    with wb.get_sheet('INPUT') as sh:
        out = []
        for row in sh.rows():
            v = [c.v for c in row]
            v += [None] * (15 - len(v))
            if isinstance(v[9], str) and v[9].strip().upper() in ('CAMPURAN','JABON','MAHONI','SENGON','KARET','AFRIKANA'):
                out.append([v[9], v[10], v[11], v[12], v[13], v[14]])
            if len(out) >= 8:
                break
for r in out:
    clean = []
    for x in r:
        if isinstance(x, float) and x.is_integer():
            x = int(x)
        clean.append('' if x is None else str(x))
    print('\t'.join(clean))
