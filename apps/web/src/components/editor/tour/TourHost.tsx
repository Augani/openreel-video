import { SpotlightTour } from "./SpotlightTour";
import { MoGraphTour } from "./MoGraphTour";

/** Both tours, in one lazily loaded chunk (see tour-launch.ts for when the editor mounts it). */
export default function TourHost() {
  return (
    <>
      <SpotlightTour />
      <MoGraphTour />
    </>
  );
}
