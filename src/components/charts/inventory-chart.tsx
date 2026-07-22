import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ChartData {
  name: string;
  value: number;
}

interface InventoryChartProps {
  data: ChartData[];
}

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444"];

export function InventoryPieChart({ data }: InventoryChartProps) {
  const chartData =
    data && data.length > 0
      ? data
      : [
          { name: "Finished Goods", value: 400 },
          { name: "Chemicals", value: 300 },
          { name: "Packaging", value: 150 },
        ];

  return (
    <Card className="col-span-1 lg:col-span-4  border-slate-200 dark:border-slate-800">
      <CardHeader>
        <CardTitle>Inventory Composition</CardTitle>
        <CardDescription>Value distribution by category</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                fill="#8884d8"
                paddingAngle={5}
                dataKey="value"
              >
                {chartData.map((entry: ChartData, index: number) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => `Rs. ${value.toLocaleString()}`}
                contentStyle={{
                  borderRadius: "8px",
                  border: "none",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
              />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
