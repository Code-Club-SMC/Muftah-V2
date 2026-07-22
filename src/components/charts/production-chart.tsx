import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
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

interface ProductionChartProps {
  data: ChartData[];
}

export function ProductionChart({ data }: ProductionChartProps) {
  const chartData =
    data && data.length > 0
      ? data
      : [
          { name: "Mon", value: 120 },
          { name: "Tue", value: 150 },
          { name: "Wed", value: 180 },
          { name: "Thu", value: 200 },
          { name: "Fri", value: 160 },
          { name: "Sat", value: 90 },
          { name: "Sun", value: 0 },
        ];

  return (
    <Card className="col-span-1 lg:col-span-4  border-slate-200 dark:border-slate-800">
      <CardHeader>
        <CardTitle>Production Output</CardTitle>
        <CardDescription>Daily carton output (Last 7 Days)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis
                dataKey="name"
                stroke="#888888"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#888888"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}`}
              />
              <Tooltip
                cursor={{ fill: "transparent" }}
                contentStyle={{
                  borderRadius: "8px",
                  border: "none",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
              />
              <Bar
                dataKey="value"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
                barSize={30}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
