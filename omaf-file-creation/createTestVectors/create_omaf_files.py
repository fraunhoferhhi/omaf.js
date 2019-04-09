#!/usr/bin/env python
"""
This script is a part of The Fraunhofer OMAF Javascript Player implementation.
(c) Copyright  1995 - 2019 Fraunhofer-Gesellschaft zur Foerderung der angewandten Forschung e.V. All rights reserved.

Please see [LICENSE.txt](../LICENSE.txt) file for the terms of use of the contents of this repository.

It creates test vectors for HEVC-based viewport-dependent OMAF video profile with MCTS

This script takes as input an ERP projected YUV file and creates the OMAF test vectors in the following 5 steps:
Step 1: convert ERP yuv to high res CMP yuv
        WARNING: This file is a raw video file with 6k resolution, it will consume a lot of storage.
Step 2: downlscale highres CMP yuv to additional lowres CMP yuv
Step 3: split both high and low res files into 24 tiles (each). This creates all required yuv tiles
Step 4: run HM and encode each tile as MCTS for provided QPs
        WARNING: this process might consume a lot of time since HM reference software is not optimized for speed
Step 5: package encoded HEVC bitstreams to OMAF files

You can skip certain steps. Use --help for more information on all available options.

Example usage:
./create_omaf_files.py -i Formula3VR_Garage_8192x4096.yuv -f 9 -q 32 -t 8 -c HMconfig.cfg
  process 9 frames of Formula3VR_Garage_8192x4096.yuv with single QP 32 and use max 8 threads.

./create_omaf_files.py -s 4-5 -i out/yuv/OutLap/ -f 9 -p OutLap -c HMconfig.cfg -q 24
  encode (with QP=24) and package yuv files from 'out/yuv/OutLap' directory
"""

import sys
import os
import time
import argparse
import shutil
import re
import shlex, subprocess

__author__ = "Dimitri Podborski"
__version__ = "0.1"
__maintainer__ = "Dimitri Podborski"
__email__ = "dimitri.podborski@hhi.fraunhofer.de"
__status__ = "Development"


NalUnitType = ['TRAIL_N',
  'TRAIL_R',
  'TSA_N',
  'TLA_R',
  'STSA_N',
  'STSA_R',
  'RADL_N',
  'RADL_R',
  'RASL_N',
  'RASL_R',
  'RSV_VCL_N10',
  'RSV_VCL_R11',
  'RSV_VCL_N12',
  'RSV_VCL_R13',
  'RSV_VCL_N14',
  'RSV_VCL_R15',
  'BLA_W_LP',
  'BLA_W_RADL',
  'BLA_N_LP',
  'IDR_W_RADL',
  'IDR_N_LP',
  'CRA_NUT',
  'RSV_IRAP_VCL22',
  'RSV_IRAP_VCL23',
  'RSV_VCL24',
  'RSV_VCL25',
  'RSV_VCL26',
  'RSV_VCL27',
  'RSV_VCL28',
  'RSV_VCL29',
  'RSV_VCL30',
  'RSV_VCL31',
  'VPS_NUT',
  'SPS_NUT',
  'PPS_NUT',
  'AUD_NUT',
  'EOS_NUT',
  'EOB_NUT',
  'FD_NUT',
  'PREFIX_SEI_NUT',
  'SUFFIX_SEI_NUT',
  'RSV_NVCL41',
  'RSV_NVCL42',
  'RSV_NVCL43',
  'RSV_NVCL44',
  'RSV_NVCL45',
  'RSV_NVCL46',
  'RSV_NVCL47',
  'UNSPEC48',
  'UNSPEC49',
  'UNSPEC50',
  'UNSPEC51',
  'UNSPEC52',
  'UNSPEC53',
  'UNSPEC54',
  'UNSPEC55',
  'UNSPEC56',
  'UNSPEC57',
  'UNSPEC58',
  'UNSPEC59',
  'UNSPEC60',
  'UNSPEC61',
  'UNSPEC62',
  'UNSPEC63',
  'INVALID']


# FUNCTIONS
def get_nal_units(buf):
    nalus = list()
    for i in range(0, len(buf) - 6):
        if buf[i + 1] == '\x00' and buf[i + 2] == '\x00' and buf[i + 3] == '\x01':
            nalu = {'offset': 0, 'auStart': False, 'type': 0, 'layerID': 0, 'tempID': 0}
            if buf[i] == '\x00':
                nalu['offset'] = i
                nalu['auStart'] = True
            else:
                nalu['offset'] = i + 1
            h1 = buf[i + 4]
            h2 = buf[i + 5]

            nalu['type'] = (ord(h1) & 0x7E) >> 1
            nalu['layerID'] = ((ord(h1) & 0x01) << 5) + ((ord(h2) & 0xF8) >> 3)
            nalu['tempID'] = (ord(h2) & 0x07) - 1
            nalus.append(nalu)
    return nalus


def find_filtered_nalu_offsets(nalus):
    offsets = list()
    nalu_cnt = len(nalus)
    for idx in range(nalu_cnt):
        if nalus[idx]['type'] > NalUnitType.index('PPS_NUT'):
            continue  # skip all non picture NALs (but don't touch param sets)
        begin = nalus[idx]['offset']
        if idx < nalu_cnt - 1:
            end = nalus[idx + 1]['offset']
        else:
            end = -1
        offsets.append([begin, end])

    return offsets


def write_file_from_offsets(filename, buffer, split_offsets):
    with open(filename, mode='wb') as file:
        for offsetpair in split_offsets:
            file.write(buffer[offsetpair[0]:offsetpair[1]])


def make_dirs_if_not_exist(dir_path):
    if not os.path.exists(dir_path):
        os.makedirs(dir_path)


def print_message(msg):
    print "\n" + "#" * 80
    print "### " + str(msg)
    print "#" * 80 + "\n"


def execute_cmd(cmd_string):
    ret_code = subprocess.call(cmd_string, shell=True)
    if not ret_code == 0:
        print "ERROR: something went wrong with: ", cmd_string
        sys.exit(-1)


def execute_cmds(cmds_string, num_threads=8):
    count = len(cmds_string)
    n = 0
    if count == 0:
        return
    processes = []
    while True:
        while cmds_string and len(processes) < num_threads:
            cmd = cmds_string.pop()

            args = shlex.split(cmd)
            processes.append(subprocess.Popen(args))

        for p in processes:
            if p.poll() is not None:
                if p.returncode == 0:
                    processes.remove(p)
                    n += 1
                    print "{} jobs finished. Still to finish: {}".format(n, count-n)
                else:
                    print "ERROR: executing command: errorcode={}".format(p.returncode)
                    sys.exit(-1)

        if len(processes) == 0 and len(cmds_string) == 0:
            break
        else:
            time.sleep(0.05)


def check_tiles(dir_path, frames):
    ctr = 0
    tile_frames = 0
    for file_str in os.listdir(dir_path):
        if not file_str.endswith('.yuv') or "Tile" not in file_str:
            continue
        if "384" in file_str:
            tile_frames = get_frame_cnt_yuv420(os.path.join(dir_path, file_str), 384, 384)
            ctr += 1
        elif "768" in file_str:
            tile_frames = get_frame_cnt_yuv420(os.path.join(dir_path, file_str), 768, 768)
            ctr += 1
        if not tile_frames==frames:
            return False
    return ctr == 48


def check_hevc_tiles(dir_path, qp):
    ctr = 0
    for file_str in os.listdir(dir_path):
        if not file_str.endswith('.265') or "qp{}".format(qp) not in file_str:
            continue
        if "384" in file_str or "768" in file_str:
            ctr += 1
    return ctr == 48


def find_files_in_dir(dir_path, search_string):
    """
    This function searches all files in provided dir and finds all files which contain searchPattern in a filename
    :param dir_path: directory to search
    :param search_string: string to search for
    :return: list of paths which have the search_string in the filename
    """
    ret_val = []
    for file_str in os.listdir(dir_path):
        if search_string in file_str:
            ret_val.append(os.path.join(dir_path, file_str))
    return ret_val


def get_frame_cnt_yuv420(file_path, width, height):
    file_size = os.path.getsize(file_path)
    frame_size = (width*height*3)/2
    return int(file_size/frame_size)


def get_file_prefix(file_in):
    file_in_base = os.path.basename(file_in)
    match = re.search(r'\s*((\d+)x(\d+))', file_in_base)
    if match:
        filename_prefix = file_in_base[0:file_in_base.find(match.group(1))]
    else:
        filename_prefix = file_in_base[:-4]
    return filename_prefix.replace('_', '')


def get_step1_cmd(bin_dir, output_dir, file_in, width, height, frame_cnt, bit_depth, chroma_format):
    cmd = os.path.join(bin_dir, 'TApp360Convert')
    if not os.path.exists(cmd):
        print "\"{}\" not found".format(cmd)
        return None

    cmd += " --InputFile={} --InputBitDepth={} --InputChromaFormat={} --SourceWidth={} --SourceHeight={}".format(
        file_in, bit_depth, chroma_format, width, height)
    if frame_cnt > 0:
        cmd += " --FramesToBeEncoded={}".format(frame_cnt + 1)
    cmd += " --OutputChromaFormat=420 --CodingGeometryType=1 --CodingFPStructure='2 3  4 0 0 0 5 0  1 0 3 90 2 270'" \
           " --CodingFaceWidth=1536 --CodingFaceHeight=1536 --OutputFile={}".format(
        os.path.join(output_dir, "highres.yuv"))
    return cmd


def get_step2_cmd(input_dir, output_dir):
    high_res_files = find_files_in_dir(input_dir, "highres")
    if len(high_res_files) == 0:
        print "Error: no highres file found in {}".format(input_dir)
        return None
    elif len(high_res_files) > 1:
        print "Warn: more than 1 highres files found in {}. select first: {}".format(input_dir, high_res_files[0])

    cmd = "ffmpeg -y -loglevel quiet -f rawvideo -pix_fmt yuv420p -s:v 4608x3072 -i {} -pix_fmt yuv420p" \
           " -s:v 2304x1536 {}".format(high_res_files[0], os.path.join(output_dir, "lowres_2304x1536.yuv"))
    return cmd


def get_step3_cmd(input_dir, output_dir, guardband_size, guardband_mode):
    high_res_files = find_files_in_dir(input_dir, "highres")
    if len(high_res_files) == 0:
        print "Error: no highres file found in {}".format(input_dir)
        return None
    elif len(high_res_files) > 1:
        print "Warn: more than 1 highres files found in {}. select first: {}".format(input_dir, high_res_files[0])

    low_res_files = find_files_in_dir(input_dir, "lowres")
    if len(low_res_files) == 0:
        print "Error: no lowres file found in {}".format(input_dir)
        return None
    elif len(low_res_files) > 1:
        print "Warn: more than 1 lowres files found in {}. select first: {}".format(input_dir, low_res_files[0])

    cmds = []
    for size in [768, 384]:
        for n in range(24):
            input_file = high_res_files[0]
            output_file = "Tile_{}x{}_{}.yuv".format(size, size, n)
            if size == 384:
                input_file = low_res_files[0]
            x = (n % 6) * size
            y = int(n / 6) * size
            cmd = "ffmpeg"

            # do we use guardbands?
            if guardband_size == 0:  # no
                cmd += " -y -loglevel quiet -f rawvideo -pix_fmt yuv420p" \
                       " -s:v {}x{} -i {} -filter:v \"crop={}:{}:{}:{}\"" \
                       " {}".format(size * 6, size * 4, input_file, size, size, x, y, os.path.join(output_dir, output_file))
            else:
                gb = guardband_size
                cmd += " -y -loglevel quiet -f rawvideo -pix_fmt yuv420p" \
                       " -s:v {}x{} -i {} -filter:v \"crop={}:{}:{}:{}[cr];[cr]scale={}:{}[sc]; [sc]pad={}:{}:{}:{}[pd]; [pd]fillborders={}:{}:{}:{}:{}\"" \
                       " {}".format(size * 6, size * 4, input_file, size, size, x, y, size - gb * 2, size - gb * 2, size,
                                    size, gb, gb, gb, gb, gb, gb, guardband_mode, os.path.join(output_dir, output_file))
            cmds.append(cmd)
    return cmds


def get_step4_cmd(bin_dir, input_dir, output_dir, file_prefix, qps, fps, frame_cnt, config_file, hhi_encoder):
    enc_bin = os.path.join(bin_dir, 'TAppEncoder')
    if hhi_encoder is True:
        enc_bin = os.path.join(bin_dir, 'FileInputTest')
    elif not os.path.exists(config_file):
        print "HM config file \"{}\" not found".format(config_file)
        return None
    if not os.path.exists(enc_bin):
        print "\"{}\" not found".format(enc_bin)
        return None

    if not hhi_encoder and len(qps) > 1:
        # HM needs to be updated to support multiple QPs
        print "WARNING: Multiple QPs are not supported for now. HM Encoder needs to be updated for this. " \
              "Continue now with QP={}".format(qps[0])
        qps = [qps[0]]

    cmds = []
    for qp in qps:
        for size in [768, 384]:
            for n in range(24):
                input_file = "Tile_{}x{}_{}.yuv".format(size, size, n)
                output_file = "{}_{}x{}_qp{}_seg{}.265".format(file_prefix, size, size, qp, n)
                log_file = "{}_{}x{}_qp{}_seg{}.log".format(file_prefix, size, size, qp, n)
                input_file = os.path.join(input_dir, input_file)
                output_file = os.path.join(output_dir, 'qp{}'.format(qp), output_file)
                log_file = os.path.join(output_dir, 'qp{}'.format(qp), log_file)

                cmd = enc_bin
                if hhi_encoder is True:
                    cmd += " --InputFileName {}".format(input_file)
                    input_file_frames = get_frame_cnt_yuv420(input_file, size, size)

                    if input_file_frames < 20:
                        cmd += " --Prefetch {}".format(input_file_frames)
                    if frame_cnt > 0:
                        if frame_cnt + 1 > input_file_frames:
                            print "Error: provided frame count {}+1 is to big " \
                                  "for file {} with {} frames.".format(frame_cnt, input_file, input_file_frames)
                            return None
                        cmd += " --NumFrames {}".format(frame_cnt + 1)
                    cmd += " --m 1 --CodingFlags 0 --Verbosity 1 --TicksPerSecond 90000 --NumThreads 2 --SceneCutDetection 0" \
                           " --Quality 14 -r 0 --FileBitDepth 8 --InternalBitDepth 8 --IDRPeriod 9 --ParallelismMode 3"
                    cmd += " --Width {} --Height {}  --TemporalRate {} --Qp {}" \
                           " --BitstreamFileName {} &>{}".format(size, size, fps, qp, output_file, log_file)
                else:
                    cmd += " --InputFile={} -c {}".format(input_file, config_file)
                    if frame_cnt > 0:
                        input_file_frames = get_frame_cnt_yuv420(input_file, size, size)
                        if frame_cnt + 1 > input_file_frames:
                            print "Error: provided frame count {}+1 is to big " \
                                  "for file {} with {} frames.".format(frame_cnt, input_file, input_file_frames)
                            return None
                        cmd += " --FramesToBeEncoded={}".format(frame_cnt + 1)
                    cmd += " --SEITempMotionConstrainedTileSets=1 --SEITMCTSTileConstraint=1"
                    cmd += " --SourceWidth={} --SourceHeight={} --FrameRate={} --QP={} --InputBitDepth=8" \
                           " --BitstreamFile={} &>{}".format(size, size, fps, qp, output_file, log_file)
                cmds.append(cmd)
    return cmds


def get_step5_cmd(bin_dir, input_dir, output_dir, qps, frame_cnt, fps, file_prefix, guardband_size):
    cmd = os.path.join(bin_dir, 'hevc2omaf')
    if not os.path.exists(cmd):
        print "\"{}\" not found".format(cmd)
        return None
    cmd += " --inputDir {} --outputDir {} --QP {} --duration {} --fps {} --inputFilePrefix {}" \
           " --guardbands {}".format(input_dir, output_dir, ' '.join(str(q) for q in qps), frame_cnt, fps,
                                     file_prefix, guardband_size)
    return cmd


def filter_nalus(input_dir, qps, file_prefix):
    for qp in qps:
        hevc_dir_filtered = os.path.join(input_dir, "temp", 'qp{}'.format(qp))
        make_dirs_if_not_exist(hevc_dir_filtered)
        for size in [768, 384]:
            for n in range(24):
                input_filename = "{}_{}x{}_qp{}_seg{}.265".format(file_prefix, size, size, qp, n)
                input_path = os.path.join(input_dir, 'qp{}'.format(qp), input_filename)
                output_path = os.path.join(hevc_dir_filtered, input_filename)
                with open(input_path, mode='rb') as f:
                    buffer = f.read()
                    nalus = get_nal_units(buffer)
                    if len(nalus) < 1:
                        print 'WARN: no nal units could be found in', input_path
                        continue
                    filter_offsets = find_filtered_nalu_offsets(nalus)
                    write_file_from_offsets(output_path, buffer, filter_offsets)
        # replace old directory with filtered one
        shutil.rmtree(os.path.join(input_dir, 'qp{}'.format(qp)))
        shutil.move(hevc_dir_filtered, input_dir)
    shutil.rmtree(os.path.join(input_dir, 'temp'))


def cast_number(num_str):
    try:
        return int(num_str)
    except ValueError:
        return None


def get_steps(steps_str):
    steps = []
    single_step = cast_number(steps_str)
    if single_step and single_step < 6:
        steps.append(single_step)
    elif len(str(steps_str).split('-')) == 2:
        multi_step_str = str(steps_str).split('-')
        first_step = cast_number(multi_step_str[0])
        last_step = cast_number(multi_step_str[1])
        if not first_step or not last_step:
            return None
        elif last_step < 6:
            for n in range(first_step, last_step + 1):
                steps.append(n)
        else:
            return None
    else:
        return None
    return steps


def main():
    print "OMAF file creation script version {}\n".format(__version__)
    # COMMAND LINE STUFF
    parser = argparse.ArgumentParser(formatter_class=argparse.RawTextHelpFormatter,
                                     description='Create OMAF viewport-dependent profile mp4 files and DASH MPD.\n\n'
                                                 'This script can perform following steps:\n'
                                                 '  Step 1 - Projection convertion: ERP yuv to high res CMP yuv\n'
                                                 '  Step 2 - ScStep ale down: highres CMP yuv to additional lowres CMP yuv\n'
                                                 '  Step 3 - Tiling: split both high and low res files into 24 tiles (each).\n'
                                                 '  Step 4 - Encoding: run HM and encode each tile as MCTS for provided QPs\n'
                                                 '  Step 5 - Packaging: package encoded HEVC bitstreams to OMAF files')
    parser.add_argument('-s', '--steps', required=True, help='Select steps to perform e.g.: \n'
                                                             '1   = ERP to CMP conversion only\n'
                                                             '5   = package HEVC files only'
                                                             '3-5 = do tiling, then encode and package')
    parser.add_argument('-i', '--input', required=True, help='input depending on the lowest selected step:\n'
                                                             'Step 1: path to ERP yuv\n'
                                                             'Step 2: path to a directory with an yuv file with "highres" string inside a filename\n'
                                                             'Step 3: path to a directory with 2 yuv files (high and low resolution).\n'
                                                             '        Filenames SHALL include substring ["lowres"|"highres"]\n'
                                                             'Step 4: path to a directory with yuv files for each tile\n'
                                                             'Step 5: path to a directory with HEVC encoded files')
    parser.add_argument('-o', '--OutputDir', default='out', help='Output directory')
    parser.add_argument('-p', '--FilePrefix', help='File prefix. Can be guessed when Step 1 is provided.')
    parser.add_argument('--InputBitDepth', type=int, default=8, help='')
    parser.add_argument('-icf', '--InputChromaFormat', type=int, default=420, help='InputChromaFormatIDC')
    parser.add_argument('-wdt', '--SourceWidth', type=int, default=8192, help='Source picture width')
    parser.add_argument('-hgt', '--SourceHeight', type=int, default=4096, help='Source picture height')
    parser.add_argument('-f', '--FramesToBeEncoded', type=int, default=-1, help='Number of frames to be converted (default=all)')
    parser.add_argument('-fr', '--FrameRate', type=int, default=30, help='Frame rate')
    parser.add_argument('-q', '--QP', type=int, default=[32], nargs='+', help='Quanitzation parameter for encodings (bitrate)')
    parser.add_argument('-c', '--HMconfig', help='HM configuration file')
    parser.add_argument('-t', '--NumThreads', type=int, default=4, help='Number of parallel processes.')
    parser.add_argument('-gbs', '--GuardBandSize', type=int, default=0, help='Guard band size')
    parser.add_argument('-gbm', '--GuardBandMode', default='smear', help='Guard band mode: smear - copy pixels, mirror - mirror pixels')

    parser.add_argument('--hhienc', dest='hhienc', action='store_true', help='Use HHI encoder instead of HM')
    parser.set_defaults(hhienc=False)

    args = parser.parse_args()

    # check params
    steps = get_steps(args.steps)
    if not steps:
        print "Error: provided steps are not valid"
        return -1
    filename_prefix = args.FilePrefix
    if 1 in steps and not filename_prefix:
        filename_prefix = get_file_prefix(args.input)
    if not filename_prefix:
        print "Error: please provide file prefix with option [-p|--FilePrefix] since it can not be guessed from filename"
        return -1
    if args.hhienc is False and not args.HMconfig and 4 in steps:
        print "Error: please provide the config file for HM using [-c|HMconfig] option"
        return -1
    if args.hhienc is False and len(args.QP) > 1 and 4 in steps:
        # HM needs to be updated to support multiple QPs
        print "WARNING: Multiple QPs are not supported for now. HM Encoder needs to be updated for this. " \
              "Continue now with QP={}".format(args.QP[0])
        args.QP = [args.QP[0]]

    bin_dir = None
    if sys.platform.startswith('darwin'):
        bin_dir = os.path.join(os.getcwd(), 'bin/osx')
    elif sys.platform.startswith('linux'):
        bin_dir = os.path.join(os.getcwd(), 'bin/linux')
    elif sys.platform.startswith('win'):
        bin_dir = os.path.join(os.getcwd(), 'bin/win')
    if not bin_dir:
        print "ERROR: your OS is not supported"
        return -1

    next_input = args.input
    for step in steps:
        if step == 1:
            yuv_dir = os.path.join(args.OutputDir, 'yuv', filename_prefix)
            make_dirs_if_not_exist(yuv_dir)
            print "NOTE: The sequence you provided is now called \"{}\"" \
                  " you will find all the output files in directory \"{}\"".format(filename_prefix, yuv_dir)
            print_message("Step 1: convert ERP yuv to high res CMP yuv")
            cmd = get_step1_cmd(bin_dir, yuv_dir, next_input, args.SourceWidth, args.SourceHeight,
                                args.FramesToBeEncoded, args.InputBitDepth, args.InputChromaFormat)
            if not cmd:
                print "Error: no command to execute in step 1"
                return -1
            print "command: {}".format(cmd)
            execute_cmd(cmd)
            next_input = yuv_dir
        elif step == 2:
            print_message("Step 2: (scale down): scale down high res CMP yuv to low res CMP yuv")
            output_dir = next_input
            if 1 not in steps:
                output_dir = args.OutputDir
                make_dirs_if_not_exist(output_dir)
            cmd = get_step2_cmd(next_input, output_dir)
            if not cmd:
                print "Error: no command to execute in step 2"
                return -1
            print "command: {}".format(cmd)
            execute_cmd(cmd)
            next_input = output_dir
        elif step == 3:
            output_dir = next_input
            if 2 not in steps:
                output_dir = args.OutputDir
                make_dirs_if_not_exist(output_dir)
            cmds = get_step3_cmd(next_input, output_dir, args.GuardBandSize, args.GuardBandMode)
            if not cmds:
                print "Error: no commands to execute in step 4"
                return -1
            print_message("Step 3: (create tiles): run {} tile cropping jobs".format(len(cmds)))
            print "First command: {}".format(cmds[0])
            execute_cmds(cmds)
            next_input = output_dir
        elif step == 4:
            hevc_dir = os.path.join(args.OutputDir, 'hevc', filename_prefix)
            make_dirs_if_not_exist(hevc_dir)
            if args.QP:
                for qp in args.QP:
                    make_dirs_if_not_exist(os.path.join(hevc_dir, "qp{}".format(qp)))
            cmds = get_step4_cmd(bin_dir, next_input, hevc_dir, filename_prefix, args.QP, args.FrameRate,
                                 args.FramesToBeEncoded, args.HMconfig, args.hhienc)
            if not cmds:
                print "Error: no commands to execute in step 4"
                return -1
            print_message("Step 4: (encode): run {} encoding jobs".format(len(cmds)))
            print "First command: {}".format(cmds[0])
            execute_cmds(cmds)

            # if HHIenc is used, filter NALs
            if args.hhienc is True:
                filter_nalus(hevc_dir, args.QP, filename_prefix)
            next_input = hevc_dir
        elif step == 5:
            omaf_dir = os.path.join(args.OutputDir, 'omaf', filename_prefix)
            make_dirs_if_not_exist(omaf_dir)

            print_message("Step 5 (OMAF packaging)")
            cmd = get_step5_cmd(bin_dir, next_input, omaf_dir, args.QP, args.FramesToBeEncoded, args.FrameRate,
                                filename_prefix, args.GuardBandSize)
            print "command: {}".format(cmd)
            execute_cmd(cmd)
    return 0


# run
if __name__ == '__main__':
    sys.exit(main())
