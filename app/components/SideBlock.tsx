type Props = {
  regionName?: string;
  userLat?: number;
  userLon?: number;
  isVerified?: boolean;
};

export default function SideBlock({ regionName, userLat, userLon, isVerified }: Props) {
    return (
      <div className="space-y-6 text-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            Your Location
          </p>
          {regionName ? (
            <>
              <p className="text-slate-100 font-medium">{regionName}</p>
              {userLat && userLon && (
                <p className="text-xs text-slate-500 mt-1">
                  {userLat.toFixed(4)}°, {userLon.toFixed(4)}°
                </p>
              )}
              {isVerified && (
                <p className="text-xs text-emerald-400 mt-1">✓ ZK Verified</p>
              )}
            </>
          ) : (
            <p className="text-slate-400 text-xs">
              Connect wallet and detect location to begin
            </p>
          )}
        </div>
  
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            How it works
          </p>
          <ul className="text-xs text-slate-300 space-y-1">
            <li>• Detect your browser location</li>
            <li>• Generate a ZK proof of location</li>
            <li>• Trade on local prediction markets</li>
          </ul>
        </div>
  
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            Privacy
          </p>
          <p className="text-xs text-slate-300">
            Your exact coordinates are never revealed. The ZK proof only confirms you are within a region.
          </p>
        </div>
      </div>
    );
  }
  