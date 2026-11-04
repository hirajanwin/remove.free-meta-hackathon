import { describe, expect, it } from "vitest"
import { fitRect } from "../social"
import { parseTemplateCsv, templateFor } from "../template-csv"

describe("fitRect", () => {
  it("contain-fits and centres", () => {
    const r = fitRect(800, 400, 1080, 1080)
    expect(r.w).toBe(1080)
    expect(r.h).toBe(540)
    expect(r.y).toBe(270)
  })

  it("fits portrait into landscape", () => {
    const r = fitRect(400, 800, 1600, 900)
    expect(r.h).toBe(900)
    expect(r.w).toBe(450)
    expect(r.x).toBe(575)
  })
})

describe("parseTemplateCsv", () => {
  it("reads file/caption/color and ignores junk columns", () => {
    const rows = parseTemplateCsv(
      'file,caption,color,notes\nshoe.jpg,"Red, fast",#ff0000,x\nbag.png,,not-a-color,y'
    )
    expect(rows).toEqual([
      { file: "shoe.jpg", caption: "Red, fast", color: "#ff0000" },
      { file: "bag.png" },
    ])
  })

  it("reads a badge column, capped at 10 chars", () => {
    const rows = parseTemplateCsv("file,badge\nshoe.png,-20%\nbag.png,VERYLONGBADGE")
    expect(rows[0].badge).toBe("-20%")
    expect(rows[1].badge).toBe("VERYLONGBA")
  })

  it("needs a file column and a data row", () => {
    expect(parseTemplateCsv("a,b\n1,2")).toEqual([])
    expect(parseTemplateCsv("file,caption")).toEqual([])
  })
})

describe("templateFor", () => {
  it("matches ignoring extension and case", () => {
    const rows = parseTemplateCsv("file,caption\nShoe.JPG,Hi")
    expect(templateFor(rows, "shoe")?.caption).toBe("Hi")
    expect(templateFor(rows, "other")).toBeUndefined()
  })
})
