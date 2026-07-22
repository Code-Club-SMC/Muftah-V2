import { Link } from "@tanstack/react-router";
import { Zap } from "lucide-react";

export const CompanyName = () => {
  return (
    <div className="relative hidden lg:flex bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 overflow-hidden">
      {/* Animated background gradient orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-primary-500/20 to-transparent rounded-full blur-3xl animate-pulse"></div>
        <div
          className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-primary-500/20 to-transparent rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: "1s" }}
        ></div>
      </div>

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:50px_50px]"></div>

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-between p-12 w-full">
        {/* Logo and Company Name */}
        <div className="space-y-8">
          {/* Logo */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-primary-600  shadow-purple-500/50">
            <Zap className="size-8 text-white" fill="currentColor" />
          </div>

          {/* Company Name with stunning typography */}
          <div className="space-y-3">
            <h1 className="text-6xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-white via-purple-200 to-white bg-clip-text text-transparent italic animate-gradient font-extrabold text-7xl">
                Titan
              </span>
            </h1>
            <p className="text-2xl font-light italic text-purple-200/80 tracking-wide">
              Enterprises Inc.
            </p>
          </div>

          {/* Tagline */}
          <p className="text-lg text-slate-300/70 max-w-md leading-relaxed">
            Clean Clothes, Confident Life.
          </p>
        </div>

        {/* Features Grid */}
        {/*<div className="grid grid-cols-2 gap-6 mt-auto">
					<FeatureCard
						icon={<ShieldIcon className="w-5 h-5" />}
						title="Secure"
						description="Bank-level encryption"
					/>
					<FeatureCard
						icon={<Zap className="w-5 h-5" />}
						title="Fast"
						description="Lightning speed"
					/>
					<FeatureCard
						icon={<TrendingUpDown className="w-5 h-5" />}
						title="Scalable"
						description="Grows with you"
					/>
					<FeatureCard
						icon={<SparklesIcon className="w-5 h-5" />}
						title="Modern"
						description="Latest technology"
					/>
				</div>*/}

        {/* Bottom accent */}
        <div className="mt-12 pt-8 border-t border-white/10">
          <p className="text-sm text-slate-400">
            Trusted by <span className="text-white font-semibold">10,000+</span>{" "}
            users worldwide
          </p>
        </div>
      </div>

      {/* Decorative elements */}
      <div className="absolute top-1/4 right-12 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-1/4 left-12 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl"></div>
    </div>
  );
};

// type Props = {
// 	icon: React.ReactNode;
// 	title: string;
// 	description: string;
// };

// Feature Card Component
// const FeatureCard = ({ icon: Icon, title, description }: Props) => {
// 	return (
// 		<div className="group p-4 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-purple-500/50 transition-all duration-300">
// 			<div className="flex items-start space-x-3">
// 				<div className="p-2 rounded-lg bg-purple-500/20 text-purple-300 group-hover:bg-purple-500/30 transition-colors">
// 					{Icon}
// 				</div>
// 				<div>
// 					<h3 className="text-sm font-semibold text-white">{title}</h3>
// 					<p className="text-xs text-slate-400 mt-0.5">{description}</p>
// 				</div>
// 			</div>
// 		</div>
// 	);
// };

// Simple Header Component
export const Header = () => {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2 lg:hidden">
        <div className="size-8 rounded-lg bg-gradient-to-br from-purple-500 to-primary-600 flex items-center justify-center">
          <Zap className="w-4 h-4 text-white" fill="currentColor" />
        </div>
        <span className="text-lg font-bold">Titan</span>
      </div>
      <div className="ml-auto">
        <Link
          to="/"
          className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
        >
          Need help?
        </Link>
      </div>
    </div>
  );
};
