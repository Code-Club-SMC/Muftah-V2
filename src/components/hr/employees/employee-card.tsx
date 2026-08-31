import { Image } from "@unpic/react";
import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cn } from "@/lib/utils";

export interface EmployeeCardEmployee {
	id: string;
	firstName: string;
	lastName: string;
	employeeCode: string;
	designation: string;
	department: string | null;
}

const BRAND = {
	navy: "#004B9B",
	navyDark: "#00346F",
	blueLine: "#005DAE",
	yellow: "#FFC629",
	white: "#FFFFFF",
} as const;

const CARD = {
	widthMm: 54,
	heightMm: 85.6,
	previewWidthPx: 300,
} as const;

// ── Code 128 barcode generator ─────────────────────────────────────────────

const CODE_128_START_B = 104;
const CODE_128_STOP = 106;
const CODE_128_QUIET_ZONE = 10;
const CODE_128_B_PATTERNS = [
	"212222",
	"222122",
	"222221",
	"121223",
	"121322",
	"131222",
	"122213",
	"122312",
	"132212",
	"221213",
	"221312",
	"231212",
	"112232",
	"122132",
	"122231",
	"113222",
	"123122",
	"123221",
	"223211",
	"221132",
	"221231",
	"213212",
	"223112",
	"312131",
	"311222",
	"321122",
	"321221",
	"312212",
	"322112",
	"322211",
	"212123",
	"212321",
	"232121",
	"111323",
	"131123",
	"131321",
	"112313",
	"132113",
	"132311",
	"211313",
	"231113",
	"231311",
	"112133",
	"112331",
	"132131",
	"113123",
	"113321",
	"133121",
	"313121",
	"211331",
	"231131",
	"213113",
	"213311",
	"213131",
	"311123",
	"311321",
	"331121",
	"312113",
	"312311",
	"332111",
	"314111",
	"221411",
	"431111",
	"111224",
	"111422",
	"121124",
	"121421",
	"141122",
	"141221",
	"112214",
	"112412",
	"122114",
	"122411",
	"142112",
	"142211",
	"241211",
	"221114",
	"413111",
	"241112",
	"134111",
	"111242",
	"121142",
	"121241",
	"114212",
	"124112",
	"124211",
	"411212",
	"421112",
	"421211",
	"212141",
	"214121",
	"412121",
	"111143",
	"111341",
	"131141",
	"114113",
	"114311",
	"411113",
	"411311",
	"113141",
	"114131",
	"311141",
	"411131",
	"211412",
	"211214",
	"211232",
	"2331112",
] as const;

type Code128Bar = { x: number; width: number };

export function normalizeBarcodeValue(value: string) {
	const printableAscii = value
		.trim()
		.split("")
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code >= 32 && code <= 126;
		})
		.join("");
	return printableAscii || "UNKNOWN";
}

function encodeCode128B(rawValue: string) {
	const value = normalizeBarcodeValue(rawValue);
	const dataCodes = value.split("").map((char) => char.charCodeAt(0) - 32);
	let checksum = CODE_128_START_B;
	dataCodes.forEach((code, index) => {
		checksum += code * (index + 1);
	});
	checksum %= 103;

	const codes = [CODE_128_START_B, ...dataCodes, checksum, CODE_128_STOP];
	const bars: Code128Bar[] = [];
	let x = 0;

	codes.forEach((code) => {
		const pattern = CODE_128_B_PATTERNS[code];
		if (!pattern) return;
		pattern.split("").forEach((widthText, index) => {
			const width = Number(widthText);
			if (index % 2 === 0) {
				bars.push({ x, width });
			}
			x += width;
		});
	});

	return { value, bars, moduleCount: x };
}

export function BarcodeSvg({
	value,
	className,
	barHeight = 76,
	showValue = true,
}: {
	value: string;
	className?: string;
	barHeight?: number;
	showValue?: boolean;
}) {
	const encoded = encodeCode128B(value);
	const labelHeight = showValue ? 18 : 0;
	const width = encoded.moduleCount + CODE_128_QUIET_ZONE * 2;
	const height = barHeight + labelHeight;

	return (
		<svg
			className={className}
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			role="img"
			aria-label={`Employee barcode ${encoded.value}`}
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect width={width} height={height} fill="#ffffff" />
			<g
				transform={`translate(${CODE_128_QUIET_ZONE} 0)`}
				shapeRendering="crispEdges"
			>
				{encoded.bars.map((bar, index) => (
					<rect
						key={`${bar.x}-${index}`}
						x={bar.x}
						y={0}
						width={bar.width}
						height={barHeight}
						fill="#000000"
					/>
				))}
			</g>
			{showValue ? (
				<text
					x={width / 2}
					y={barHeight + 13}
					textAnchor="middle"
					fontFamily="Arial, sans-serif"
					fontSize="9"
					letterSpacing="1.2"
					fill="#111827"
				>
					{encoded.value}
				</text>
			) : null}
		</svg>
	);
}

// ── Shared card shell ──────────────────────────────────────────────────────

function CardShell({
	children,
	className,
	style,
}: {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<div
			className={cn(
				"relative flex overflow-hidden rounded-[18px] shadow-xl ring-1 ring-black/10",
				className,
			)}
			style={{
				width: CARD.previewWidthPx,
				height: CARD.previewWidthPx * (CARD.heightMm / CARD.widthMm),
				...style,
			}}
		>
			{children}
		</div>
	);
}

// ── Front of card ──────────────────────────────────────────────────────────

function CardFront({
	employee,
	fullName,
	barcodeValue,
}: {
	employee: EmployeeCardEmployee;
	fullName: string;
	barcodeValue: string;
}) {
	return (
		<CardShell className="flex-col bg-white">
			<div
				className="flex h-[68px] items-center justify-center"
				style={{ background: BRAND.navy }}
			>
				<p className="text-[25px] font-black uppercase tracking-[0.09em] text-white">
					Service Card
				</p>
			</div>

			<div className="flex flex-col px-5 pt-5 pb-0">
				<InfoField label="Employee Code" value={employee.employeeCode} />
				<Divider />
				<InfoField label="Employee Name" value={fullName} />
				<Divider />
				<InfoField label="Designation" value={employee.designation} />
				<Divider />
				<InfoField label="Department" value={employee.department ?? "-"} />

				<div className="mt-2 h-[3px]" style={{ background: BRAND.blueLine }} />

				<div className="flex flex-1 items-center justify-center py-4 min-h-[140px]">
					<BarcodeSvg
						value={barcodeValue}
						className="h-[120px] w-full"
						barHeight={92}
					/>
				</div>
			</div>

			<div className="px-4 py-3 text-center" style={{ background: BRAND.navy }}>
				<p className="text-[12px] font-black uppercase tracking-[0.14em] text-white">
					If found, please return to
				</p>
				<p className="mt-1 text-[13px] font-black uppercase tracking-[0.08em] text-white">
					Muftah Chemical Pvt LTD
				</p>
				<p className="mt-1 text-[12px] font-bold tracking-[0.08em] text-white">
					03009040816
				</p>
			</div>
		</CardShell>
	);
}

function InfoField({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid grid-cols-[100px_10px_1fr] items-baseline gap-2 py-2.5">
			<span className="text-[12px] font-black uppercase tracking-[-0.03em] text-black">
				{label}
			</span>
			<span className="text-[13px] font-black text-black">:</span>
			<span className="break-words leading-snug text-[14px] font-medium text-black">
				{value}
			</span>
		</div>
	);
}

function Divider() {
	return <div className="h-px bg-black/20" />;
}

// ── Back of card ───────────────────────────────────────────────────────────

function ArchLogo() {
	return (
		<div className="relative mb-8 flex items-center justify-center">
			<Image
				src="/company-logo.svg"
				alt="Muftah Chemical"
				layout="constrained"
				width={150}
				height={170}
				className="h-[150px] w-auto object-contain"
			/>
		</div>
	);
}

function CardBack() {
	return (
		<CardShell
			className="items-center justify-center"
			style={{ background: BRAND.navy }}
		>
			<div className="absolute inset-0 opacity-[0.12]">
				<GeometricPattern />
			</div>

			<div className="relative z-10 flex flex-col items-center px-8 text-center">
				<ArchLogo />

				<p className="text-[25px] font-black uppercase leading-tight tracking-[0.08em] text-white">
					Muftah Chemical
				</p>
				<p className="mt-2 text-[25px] font-black uppercase leading-tight tracking-[0.08em] text-white">
					Pvt LTD
				</p>

				<div className="my-8 flex w-[176px] items-center">
					<div
						className="h-[3px] flex-1"
						style={{ background: BRAND.yellow }}
					/>
					<div
						className="h-[15px] w-[15px] rounded-full"
						style={{ background: BRAND.yellow }}
					/>
					<div
						className="h-[3px] flex-1"
						style={{ background: BRAND.yellow }}
					/>
				</div>

				<p className="text-[14px] font-semibold tracking-[0.06em] text-white/90">
					www.muftah.pk
				</p>
			</div>
		</CardShell>
	);
}

function GeometricPattern() {
	return (
		<svg
			viewBox="0 0 220 420"
			className="absolute bottom-0 right-0 h-[72%] w-[72%]"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M120 14 188 53v78l-68 39-68-39V53l68-39Zm0 102 68 39v78l-68 39-68-39v-78l68-39Zm0 102 68 39v78l-68 39-68-39v-78l68-39Z"
				stroke="#7CC8FF"
				strokeWidth="2"
			/>
			<path
				d="M52 53 120 92l68-39M52 155l68 39 68-39M52 257l68 39 68-39M120 92v78M120 194v78M120 296v78"
				stroke="#7CC8FF"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

// ── Public preview component ───────────────────────────────────────────────

export function EmployeeCard({
	employee,
	side = "front",
}: {
	employee: EmployeeCardEmployee;
	side?: "front" | "back";
}) {
	const fullName = `${employee.firstName} ${employee.lastName}`.trim();
	const barcodeValue = normalizeBarcodeValue(employee.employeeCode);

	return side === "front" ? (
		<CardFront
			employee={employee}
			fullName={fullName}
			barcodeValue={barcodeValue}
		/>
	) : (
		<CardBack />
	);
}

// ── Print helpers ──────────────────────────────────────────────────────────

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export function openEmployeeCardPrintWindow(employee: EmployeeCardEmployee) {
	const fullName = `${employee.firstName} ${employee.lastName}`.trim();
	const barcodeValue = normalizeBarcodeValue(employee.employeeCode);
	const barcodeSvg = renderToStaticMarkup(
		<BarcodeSvg value={barcodeValue} barHeight={84} />,
	);

	const printWindow = window.open("", "_blank");
	if (!printWindow) return;

	printWindow.document.write(
		buildPrintHTML(employee, fullName, barcodeValue, barcodeSvg),
	);
	printWindow.document.close();
	setTimeout(() => printWindow.print(), 500);
}

function buildPrintHTML(
	employee: EmployeeCardEmployee,
	fullName: string,
	barcodeValue: string,
	barcodeSvg: string,
): string {
	const navy = BRAND.navy;
	const yellow = BRAND.yellow;
	const widthMm = CARD.widthMm;
	const heightMm = CARD.heightMm;
	const safeEmployeeCode = escapeHtml(employee.employeeCode);
	const safeFullName = escapeHtml(fullName);
	const safeDesignation = escapeHtml(employee.designation);
	const safeDepartment = escapeHtml(employee.department ?? "-");
	const safeBarcodeValue = escapeHtml(barcodeValue);

	return `<!DOCTYPE html>
<html>
<head>
  <title>Service Card - ${safeFullName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: 122mm 92mm; margin: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8mm;
      background: #ffffff;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .card {
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      border-radius: 3.6mm;
      overflow: hidden;
      box-shadow: 0 2mm 6mm rgba(0,0,0,0.18);
      border: 0.2mm solid rgba(0,0,0,0.16);
    }
    .front {
      display: flex;
      flex-direction: column;
      background: white;
    }
    .header {
      height: 11mm;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${navy};
    }
    .header h1 {
      color: white;
      font-size: 4.7mm;
      font-weight: 900;
      letter-spacing: 0.35mm;
      text-transform: uppercase;
    }
    .fields {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      padding: 4.5mm 5mm 0;
    }
    .field {
      display: grid;
      grid-template-columns: 20mm 2mm 1fr;
      gap: 2mm;
      align-items: baseline;
      padding: 1.8mm 0;
    }
    .field + .field {
      border-top: 0.2mm solid rgba(0,0,0,0.2);
    }
    .field-label {
      color: #000;
      font-size: 2.25mm;
      font-weight: 900;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .field-colon {
      color: #000;
      font-size: 2.45mm;
      font-weight: 900;
    }
    .field-value {
      color: #000;
      font-size: 2.65mm;
      font-weight: 500;
      white-space: normal;
      overflow: visible;
      word-wrap: break-word;
    }
    .blue-divider {
      height: 0.55mm;
      margin-top: 1mm;
      background: ${navy};
    }
    .barcode-area {
      height: 25mm;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2mm 0 1.5mm;
    }
    .barcode-area svg {
      width: 100%;
      height: 21mm;
    }
    .barcode-fallback {
      display: none;
      color: #111827;
      text-align: center;
      font-size: 2.6mm;
      letter-spacing: 0.3mm;
    }
    .footer {
      background: ${navy};
      padding: 2.5mm 2.5mm;
      text-align: center;
      color: white;
      text-transform: uppercase;
    }
    .footer .small {
      font-size: 2.1mm;
      font-weight: 900;
      letter-spacing: 0.3mm;
    }
    .footer .company {
      margin-top: 0.6mm;
      font-size: 2.35mm;
      font-weight: 900;
      letter-spacing: 0.18mm;
    }
    .footer .phone {
      margin-top: 0.6mm;
      font-size: 2.35mm;
      font-weight: 800;
      letter-spacing: 0.18mm;
    }
    .back {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${navy};
      color: white;
      text-align: center;
    }
    .pattern {
      position: absolute;
      right: -5mm;
      bottom: -3mm;
      width: 38mm;
      height: 62mm;
      opacity: 0.12;
    }
    .back-inner {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0 7mm;
    }
    .back-logo {
      width: 26mm;
      height: auto;
      margin-bottom: 5mm;
      overflow: hidden;
    }
    .back-logo img {
      width: 100%;
      height: auto;
      display: block;
    }
    .back-name {
      font-size: 4.6mm;
      line-height: 1.35;
      font-weight: 900;
      letter-spacing: 0.35mm;
      text-transform: uppercase;
    }
    .yellow-divider {
      display: flex;
      align-items: center;
      width: 33mm;
      margin: 9mm 0 5mm;
    }
    .yellow-divider .line {
      flex: 1;
      height: 0.55mm;
      background: ${yellow};
    }
    .yellow-divider .dot {
      width: 3.2mm;
      height: 3.2mm;
      border-radius: 999px;
      background: ${yellow};
    }
    .url {
      font-size: 2.8mm;
      font-weight: 600;
      letter-spacing: 0.15mm;
      text-transform: lowercase;
    }
    @media print {
      body { min-height: auto; box-shadow: none; }
      .card { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="card front">
    <div class="header"><h1>Service Card</h1></div>
    <div class="fields">
      <div class="field"><span class="field-label">Employee Code</span><span class="field-colon">:</span><span class="field-value">${safeEmployeeCode}</span></div>
      <div class="field"><span class="field-label">Employee Name</span><span class="field-colon">:</span><span class="field-value">${safeFullName}</span></div>
      <div class="field"><span class="field-label">Designation</span><span class="field-colon">:</span><span class="field-value">${safeDesignation}</span></div>
      <div class="field"><span class="field-label">Department</span><span class="field-colon">:</span><span class="field-value">${safeDepartment}</span></div>
      <div class="blue-divider"></div>
      <div class="barcode-area">${barcodeSvg}<p class="barcode-fallback">${safeBarcodeValue}</p></div>
    </div>
    <div class="footer">
      <p class="small">If found, please return to</p>
      <p class="company">Muftah Chemical Pvt LTD</p>
      <p class="phone">03009040816</p>
    </div>
  </div>
  <div class="card back">
    <svg class="pattern" viewBox="0 0 220 420" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M120 14 188 53v78l-68 39-68-39V53l68-39Zm0 102 68 39v78l-68 39-68-39v-78l68-39Zm0 102 68 39v78l-68 39-68-39v-78l68-39Z" stroke="#7CC8FF" stroke-width="2"/>
      <path d="M52 53 120 92l68-39M52 155l68 39 68-39M52 257l68 39 68-39M120 92v78M120 194v78M120 296v78" stroke="#7CC8FF" stroke-width="1.5"/>
    </svg>
    <div class="back-inner">
      <div class="back-logo"><img src="/company-logo.svg" alt="Muftah Chemical"/></div>
      <div class="back-name">Muftah Chemical<br/>Pvt LTD</div>
      <div class="yellow-divider"><div class="line"></div><div class="dot"></div><div class="line"></div></div>
      <p class="url">www.muftah.pk</p>
    </div>
  </div>
</body>
</html>`;
}
